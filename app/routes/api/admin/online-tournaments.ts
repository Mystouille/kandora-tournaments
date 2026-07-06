import { connectToDatabase } from "../../../utils/dbConnection.server";
import { UserModel } from "../../../db/User";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { LeagueModel } from "../../../db/League";
import { LeagueTypeConfigModel } from "../../../db/LeagueTypeConfig";
import { validateLeagueTypeConfig } from "../../../services/league-configs/validation";
import { resolveOrderedPhases } from "../../../services/league-configs";
import type { LeagueTypeConfig } from "../../../services/league-configs/types";
import { LeagueService } from "../../../services/LeagueService.server";

async function requireAdmin(request: Request): Promise<Response | null> {
  const jwtPayload = await getAuthenticatedUser(request);
  if (!jwtPayload) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectToDatabase();
  const user = await UserModel.findById(jwtPayload.sub).select("isAdmin");
  if (!user?.isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** POST /api/admin/online-tournaments — create a new league */
export async function action({ request }: { request: Request }) {
  const forbidden = await requireAdmin(request);
  if (forbidden) {
    return forbidden;
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();

  if (!body.name || !body.startTime || !body.endTime) {
    return Response.json(
      { error: "Missing required fields: name, startTime, endTime" },
      { status: 400 }
    );
  }

  if (!body.platformConfig?.platformName) {
    return Response.json(
      { error: "Missing required field: platformConfig.platformName" },
      { status: 400 }
    );
  }

  if (!body.rulesConfig?.gameRules) {
    return Response.json(
      { error: "Missing required field: rulesConfig.gameRules" },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();

    // Resolve leagueTypeConfig ref: accept an existing ID or create a new config
    let leagueTypeConfigId: string | null = null;
    let resolvedConfigForPhases: LeagueTypeConfig | null = null;
    if (body.leagueTypeConfigId) {
      // Reference to an existing config
      const existing = await LeagueTypeConfigModel.findById(
        body.leagueTypeConfigId
      );
      if (!existing) {
        return Response.json(
          { error: "Referenced leagueTypeConfig not found" },
          { status: 400 }
        );
      }
      leagueTypeConfigId = existing._id.toString();
      resolvedConfigForPhases =
        existing.toObject() as unknown as LeagueTypeConfig;
    } else if (body.leagueTypeConfig != null) {
      // Create a new config document inline
      const configErrors = validateLeagueTypeConfig(body.leagueTypeConfig);
      if (configErrors.length > 0) {
        return Response.json(
          { error: "Invalid leagueTypeConfig", details: configErrors },
          { status: 400 }
        );
      }
      const created = await LeagueTypeConfigModel.create(
        body.leagueTypeConfig as Record<string, unknown>
      );
      leagueTypeConfigId = (created as any)._id.toString();
      resolvedConfigForPhases = body.leagueTypeConfig as LeagueTypeConfig;
    }

    // ── Per-phase tournament lobbies (optional) ──
    // When present, the league runs in "per-phase" mode: each config phase is
    // bound to its own tournament lobby. Games are fetched from every lobby and
    // tagged with the corresponding phaseId (see Game.phaseId).
    const phaseTournaments: Array<{
      phaseId: string;
      tournamentId: string;
      internalTournamentId?: string;
      seasonId?: string;
    }> = Array.isArray(body.platformConfig.phaseTournaments)
      ? body.platformConfig.phaseTournaments
          .filter(
            (entry: { phaseId?: unknown; tournamentId?: unknown }) =>
              entry && entry.phaseId && entry.tournamentId
          )
          .map(
            (entry: {
              phaseId: unknown;
              tournamentId: unknown;
              internalTournamentId?: unknown;
              seasonId?: unknown;
            }) => ({
              phaseId: String(entry.phaseId),
              tournamentId: String(entry.tournamentId),
              internalTournamentId: entry.internalTournamentId
                ? String(entry.internalTournamentId)
                : undefined,
              seasonId: entry.seasonId ? String(entry.seasonId) : undefined,
            })
          )
      : [];

    // Coverage validation: in per-phase mode every config phase must be bound
    // to exactly one lobby, and every lobby must reference a real phase.
    if (phaseTournaments.length > 0) {
      const orderedPhases = resolveOrderedPhases(resolvedConfigForPhases);
      if (orderedPhases.length === 0) {
        return Response.json(
          {
            error:
              "Per-phase lobbies require a league type config with at least one phase",
          },
          { status: 400 }
        );
      }
      const phaseIdsInConfig = new Set(orderedPhases.map((p) => p.id));
      const assignedPhaseIds = new Set<string>();
      for (const entry of phaseTournaments) {
        if (!phaseIdsInConfig.has(entry.phaseId)) {
          return Response.json(
            {
              error: `Per-phase lobby references unknown phase "${entry.phaseId}"`,
            },
            { status: 400 }
          );
        }
        if (assignedPhaseIds.has(entry.phaseId)) {
          return Response.json(
            {
              error: `Duplicate per-phase lobby for phase "${entry.phaseId}"`,
            },
            { status: 400 }
          );
        }
        assignedPhaseIds.add(entry.phaseId);
      }
      const missing = orderedPhases
        .filter((p) => !assignedPhaseIds.has(p.id))
        .map((p) => p.id);
      if (missing.length > 0) {
        return Response.json(
          {
            error: `Every phase requires a lobby; missing: ${missing.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    // ── Duplicate tournament guard ──
    const internalId = body.platformConfig.internalTournamentId || undefined;
    const pName = body.platformConfig.platformName;
    if (internalId) {
      const dupFilter: Record<string, unknown> = {
        "platformConfig.platformName": pName,
        "platformConfig.internalTournamentId": String(internalId),
      };
      if (pName === "MAJSOUL" && body.platformConfig.seasonId) {
        dupFilter["platformConfig.seasonId"] = String(
          body.platformConfig.seasonId
        );
      }
      const existing = await LeagueModel.findOne(dupFilter)
        .select("name")
        .lean();
      if (existing) {
        return Response.json(
          {
            error: "duplicateTournament",
            existingName: existing.name,
          },
          { status: 409 }
        );
      }
    }

    // Per-phase lobby duplicate guard: none of the phase lobbies may already be
    // tracked by another league (as its primary lobby or one of its phase
    // lobbies). Only lobbies with a resolved internalTournamentId are checked.
    const phaseInternalIds = phaseTournaments
      .map((entry) => entry.internalTournamentId)
      .filter((value): value is string => !!value);
    if (phaseInternalIds.length > 0) {
      const dupExisting = await LeagueModel.findOne({
        "platformConfig.platformName": pName,
        $or: [
          {
            "platformConfig.internalTournamentId": { $in: phaseInternalIds },
          },
          {
            "platformConfig.phaseTournaments.internalTournamentId": {
              $in: phaseInternalIds,
            },
          },
        ],
      })
        .select("name")
        .lean();
      if (dupExisting) {
        return Response.json(
          { error: "duplicateTournament", existingName: dupExisting.name },
          { status: 409 }
        );
      }
    }

    const league = await LeagueModel.create({
      name: body.name,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
      phaseCutoffTimes: (body.phaseCutoffTimes ?? []).map(
        (d: string) => new Date(d)
      ),
      isIgnored: false,
      isDisplayed: true,
      rulesConfig: {
        gameRules: body.rulesConfig.gameRules,
        isTeamMode: body.rulesConfig.isTeamMode ?? false,
      },
      platformConfig: {
        platformName: body.platformConfig.platformName,
        tournamentId: body.platformConfig.tournamentId || undefined,
        internalTournamentId: internalId,
        seasonId: body.platformConfig.seasonId
          ? String(body.platformConfig.seasonId)
          : undefined,
        phaseTournaments,
      },
      discordConfig: body.discordConfig
        ? {
            serverId: body.discordConfig.serverId || undefined,
            adminChannel: body.discordConfig.adminChannel || undefined,
            resultChannel: body.discordConfig.resultChannel || undefined,
            rankingChannel: body.discordConfig.rankingChannel || undefined,
            schedulingChannel:
              body.discordConfig.schedulingChannel || undefined,
            locale: body.discordConfig.locale === "en" ? "en" : "fr",
          }
        : undefined,
      leagueTypeConfig: leagueTypeConfigId,
    });

    // Re-evaluate league schedulers so the new league is picked up immediately
    LeagueService.instance.InitLeague().catch((err) => {
      console.error("[InitLeague] re-evaluation after create failed:", err);
    });

    return Response.json(
      { success: true, league: league.toObject() },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (
      error instanceof Error &&
      "code" in error &&
      (error as any).code === 11000
    ) {
      return Response.json(
        { error: "A league with this name already exists" },
        { status: 409 }
      );
    }

    console.error("Failed to create league:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
