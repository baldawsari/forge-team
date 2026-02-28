import Dockerode from 'dockerode';
import type { SandboxConfig } from './types';

export class SandboxManager {
  private docker: Dockerode;
  private activeContainers: Set<string> = new Set();

  constructor() {
    this.docker = new Dockerode();
  }

  async createSandbox(config: SandboxConfig): Promise<{ containerId: string }> {
    try {
      const container = await this.docker.createContainer({
        Image: config.image,
        Cmd: ['sleep', String(Math.ceil(config.timeoutMs / 1000))],
        WorkingDir: config.workingDir,
        HostConfig: {
          Memory: this.parseMemoryLimit(config.memoryLimit),
          NanoCpus: Math.floor(config.cpuLimit * 1e9),
          NetworkMode: config.networkMode === 'none' ? 'none' : config.networkMode,
          Binds: config.volumeMounts,
          AutoRemove: false,
        },
      });

      await container.start();
      const id = container.id;
      this.activeContainers.add(id);

      setTimeout(() => {
        this.destroySandbox(id).catch(() => {});
      }, config.timeoutMs);

      return { containerId: id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create sandbox: ${message}`);
    }
  }

  async execInSandbox(
    containerId: string,
    command: string[],
    options?: { timeout?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const container = this.docker.getContainer(containerId);
      const dockerExec = await container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
      });

      const stream = await dockerExec.start({ hijack: true, stdin: false });

      const timeoutMs = options?.timeout ?? 30_000;
      const { stdout, stderr } = await this.collectOutput(stream, timeoutMs);

      const inspect = await dockerExec.inspect();
      const exitCode = inspect.ExitCode ?? 1;

      return { stdout, stderr, exitCode };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { stdout: '', stderr: `Docker exec failed: ${message}`, exitCode: 1 };
    }
  }

  async destroySandbox(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      try {
        await container.stop({ t: 2 });
      } catch {
        // already stopped
      }
      await container.remove({ force: true });
    } catch {
      // container may already be removed
    } finally {
      this.activeContainers.delete(containerId);
    }
  }

  async destroyAll(): Promise<void> {
    const ids = [...this.activeContainers];
    await Promise.allSettled(ids.map((id) => this.destroySandbox(id)));
  }

  listActive(): string[] {
    return [...this.activeContainers];
  }

  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)([mgk]?)$/i);
    if (!match) return 512 * 1024 * 1024;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 'g') return value * 1024 * 1024 * 1024;
    if (unit === 'm') return value * 1024 * 1024;
    if (unit === 'k') return value * 1024;
    return value;
  }

  private collectOutput(
    stream: NodeJS.ReadableStream,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const timer = setTimeout(() => {
        stream.removeAllListeners();
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8') + '\n[timeout]',
        });
      }, timeoutMs);

      stream.on('data', (chunk: Buffer) => {
        if (chunk.length < 8) return;
        const type = chunk[0];
        const payload = chunk.slice(8);
        if (type === 1) stdoutChunks.push(payload);
        else if (type === 2) stderrChunks.push(payload);
      });

      stream.on('end', () => {
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        });
      });

      stream.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
