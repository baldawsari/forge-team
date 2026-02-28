export interface JiraClient {
  createIssue(
    project: string,
    summary: string,
    description: string,
    type: string,
  ): Promise<{ key: string; url: string }>;
  updateIssue(key: string, updates: Record<string, any>): Promise<void>;
  getIssue(key: string): Promise<{ key: string; summary: string; status: string }>;
  transitionIssue(key: string, transitionName: string): Promise<void>;
}

export interface SupabaseClient {
  query(table: string, filters?: Record<string, any>): Promise<any[]>;
  insert(table: string, data: Record<string, any>): Promise<any>;
  update(table: string, id: string, data: Record<string, any>): Promise<any>;
  createMigration(name: string, sql: string): Promise<{ path: string }>;
}

export interface VercelClient {
  deploy(
    projectId: string,
    options?: { production?: boolean },
  ): Promise<{ url: string; deploymentId: string }>;
  getDeploymentStatus(deploymentId: string): Promise<{ status: string; url: string }>;
  listDeployments(projectId: string, limit?: number): Promise<any[]>;
}

export interface WhatsAppClient {
  sendMessage(to: string, message: string): Promise<{ messageId: string }>;
  sendTemplate(
    to: string,
    templateName: string,
    params: Record<string, string>,
  ): Promise<{ messageId: string }>;
}

function requireEnv(...vars: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const missing: string[] = [];
  for (const v of vars) {
    const value = process.env[v];
    if (!value) {
      missing.push(v);
    } else {
      result[v] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}`,
    );
  }
  return result;
}

function createJiraClient(): JiraClient {
  const getConfig = () => {
    const env = requireEnv('JIRA_API_TOKEN', 'JIRA_BASE_URL', 'JIRA_EMAIL');
    const auth = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
    return { baseUrl: env.JIRA_BASE_URL.replace(/\/$/, ''), auth };
  };

  const jiraFetch = async (path: string, options: RequestInit = {}): Promise<any> => {
    const { baseUrl, auth } = getConfig();
    const response = await fetch(`${baseUrl}/rest/api/3${path}`, {
      ...options,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API error ${response.status}: ${body}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  };

  return {
    async createIssue(project, summary, description, type) {
      const data = await jiraFetch('/issue', {
        method: 'POST',
        body: JSON.stringify({
          fields: {
            project: { key: project },
            summary,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: description }],
                },
              ],
            },
            issuetype: { name: type },
          },
        }),
      });
      const { baseUrl } = getConfig();
      return { key: data.key, url: `${baseUrl}/browse/${data.key}` };
    },

    async updateIssue(key, updates) {
      await jiraFetch(`/issue/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ fields: updates }),
      });
    },

    async getIssue(key) {
      const data = await jiraFetch(
        `/issue/${encodeURIComponent(key)}?fields=summary,status`,
      );
      return {
        key: data.key,
        summary: data.fields.summary,
        status: data.fields.status.name,
      };
    },

    async transitionIssue(key, transitionName) {
      const transitions = await jiraFetch(
        `/issue/${encodeURIComponent(key)}/transitions`,
      );
      const match = transitions.transitions.find(
        (t: any) => t.name.toLowerCase() === transitionName.toLowerCase(),
      );
      if (!match) {
        throw new Error(
          `Transition "${transitionName}" not found. Available: ${transitions.transitions.map((t: any) => t.name).join(', ')}`,
        );
      }
      await jiraFetch(`/issue/${encodeURIComponent(key)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: match.id } }),
      });
    },
  };
}

function createSupabaseClient(): SupabaseClient {
  const getConfig = () => {
    const env = requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_KEY');
    return {
      baseUrl: env.SUPABASE_URL.replace(/\/$/, ''),
      key: env.SUPABASE_SERVICE_KEY,
    };
  };

  const supabaseFetch = async (
    path: string,
    options: RequestInit = {},
    extraHeaders: Record<string, string> = {},
  ): Promise<any> => {
    const { baseUrl, key } = getConfig();
    const response = await fetch(`${baseUrl}/rest/v1${path}`, {
      ...options,
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...extraHeaders,
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase API error ${response.status}: ${body}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  };

  return {
    async query(table, filters) {
      const params = new URLSearchParams();
      if (filters) {
        for (const [col, value] of Object.entries(filters)) {
          params.set(col, `eq.${value}`);
        }
      }
      const qs = params.toString();
      return supabaseFetch(`/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`);
    },

    async insert(table, data) {
      const result = await supabaseFetch(`/${encodeURIComponent(table)}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return Array.isArray(result) ? result[0] : result;
    },

    async update(table, id, data) {
      const result = await supabaseFetch(
        `/${encodeURIComponent(table)}?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(data),
        },
      );
      return Array.isArray(result) ? result[0] : result;
    },

    async createMigration(name, sql) {
      const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const fileName = `${timestamp}_${name.replace(/\s+/g, '_')}.sql`;
      const { baseUrl, key } = getConfig();
      const response = await fetch(`${baseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase migration error ${response.status}: ${body}`);
      }
      return { path: `supabase/migrations/${fileName}` };
    },
  };
}

function createVercelClient(): VercelClient {
  const getConfig = () => {
    const env = requireEnv('VERCEL_TOKEN');
    return { token: env.VERCEL_TOKEN };
  };

  const vercelFetch = async (path: string, options: RequestInit = {}): Promise<any> => {
    const { token } = getConfig();
    const response = await fetch(`https://api.vercel.com${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vercel API error ${response.status}: ${body}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  };

  return {
    async deploy(projectId, options) {
      const data = await vercelFetch('/v13/deployments', {
        method: 'POST',
        body: JSON.stringify({
          name: projectId,
          target: options?.production ? 'production' : 'preview',
          project: projectId,
        }),
      });
      return { url: data.url, deploymentId: data.id };
    },

    async getDeploymentStatus(deploymentId) {
      const data = await vercelFetch(
        `/v13/deployments/${encodeURIComponent(deploymentId)}`,
      );
      return { status: data.readyState, url: data.url };
    },

    async listDeployments(projectId, limit = 10) {
      const data = await vercelFetch(
        `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`,
      );
      return data.deployments;
    },
  };
}

function createWhatsAppClient(): WhatsAppClient {
  const getConfig = () => {
    const env = requireEnv('WHATSAPP_API_TOKEN');
    return { token: env.WHATSAPP_API_TOKEN };
  };

  const whatsappFetch = async (path: string, options: RequestInit = {}): Promise<any> => {
    const { token } = getConfig();
    const response = await fetch(
      `https://graph.facebook.com/v18.0${path}`,
      {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WhatsApp API error ${response.status}: ${body}`);
    }
    return response.json();
  };

  return {
    async sendMessage(to, message) {
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
      const data = await whatsappFetch(`/${phoneNumberId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        }),
      });
      return { messageId: data.messages[0].id };
    },

    async sendTemplate(to, templateName, params) {
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
      const components = Object.keys(params).length > 0
        ? [
            {
              type: 'body',
              parameters: Object.values(params).map((value) => ({
                type: 'text',
                text: value,
              })),
            },
          ]
        : [];
      const data = await whatsappFetch(`/${phoneNumberId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'en' },
            components,
          },
        }),
      });
      return { messageId: data.messages[0].id };
    },
  };
}

export function createExternalClients(): {
  jira: JiraClient;
  supabase: SupabaseClient;
  vercel: VercelClient;
  whatsapp: WhatsAppClient;
} {
  return {
    jira: createJiraClient(),
    supabase: createSupabaseClient(),
    vercel: createVercelClient(),
    whatsapp: createWhatsAppClient(),
  };
}

