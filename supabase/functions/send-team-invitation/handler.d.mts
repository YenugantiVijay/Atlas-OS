export function createTeamInviteHandler(dependencies: {
  env: (name: string) => string | undefined;
  fetchImpl: typeof fetch;
}): (request: Request) => Promise<Response>;
