import { createTeamInviteHandler } from './handler.mjs';

Deno.serve(createTeamInviteHandler({ env: (name: string) => Deno.env.get(name), fetchImpl: fetch }));
