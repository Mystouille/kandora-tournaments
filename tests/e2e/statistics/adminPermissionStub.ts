export async function requireLeagueAdminOrRedirect(): Promise<never> {
  throw new Error(
    "Server loaders must not run in the isolated browser harness"
  );
}
