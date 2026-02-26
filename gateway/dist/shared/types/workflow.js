"use strict";
/**
 * Workflow and SDLC pipeline type definitions for the ForgeTeam system.
 * Defines the structured flow of work through software development lifecycle phases.
 *
 * Includes both:
 * - YAML workflow definition types (parsed from workflows/*.yaml)
 * - Runtime workflow instance types (execution state)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SDLC_PHASES = void 0;
/** Predefined SDLC phases used in the BMAD-Claw workflow */
exports.SDLC_PHASES = [
    'discovery',
    'requirements',
    'architecture',
    'design',
    'implementation',
    'testing',
    'security-review',
    'documentation',
    'deployment',
    'monitoring',
];
//# sourceMappingURL=workflow.js.map