import { connectToDatabase } from "../../../utils/dbConnection.server";
import { UserModel } from "../../../db/User";
import { getAuthenticatedUser } from "../../../utils/jwt.server";
import { LeagueModel } from "../../../db/League";
import { LeagueTypeConfigModel } from "../../../db/LeagueTypeConfig";
import { validateLeagueTypeConfig } from "../../../services/league-configs/validation";

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

/**
 * GET /api/admin/league-type-config
 *   — no params: list all configs
 *   — ?id=...   : get a single config by its own _id
 */
export async function loader({ request }: { request: Request }) {
  const forbidden = await requireAdmin(request);
  if (forbidden) {
    return forbidden;
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  await connectToDatabase();

  if (!id) {
    const configs = await LeagueTypeConfigModel.find({})
      .sort({ updatedAt: -1 })
      .lean();
    return Response.json({ configs });
  }

  const config = await LeagueTypeConfigModel.findById(id).lean();
  if (!config) {
    return Response.json({ error: "Config not found" }, { status: 404 });
  }
  return Response.json({ config });
}

/**
 * POST   — create a new config
 * PUT    — update an existing config (body.id required)
 * DELETE — delete a config (body.id required); unlinks from all leagues
 */
export async function action({ request }: { request: Request }) {
  const forbidden = await requireAdmin(request);
  if (forbidden) {
    return forbidden;
  }

  const body = await request.json();

  if (request.method === "POST") {
    return handleCreate(body);
  }
  if (request.method === "PUT") {
    return handleUpdate(body);
  }
  if (request.method === "DELETE") {
    return handleDelete(body);
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

async function handleCreate(body: Record<string, unknown>) {
  const errors = validateLeagueTypeConfig(body);
  if (errors.length > 0) {
    return Response.json(
      { error: "Invalid config", details: errors },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();
    const doc = await LeagueTypeConfigModel.create(body);
    return Response.json({ config: doc.toObject() }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to create league type config:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleUpdate(body: Record<string, unknown>) {
  const { id, ...fields } = body;
  if (!id || typeof id !== "string") {
    return Response.json(
      { error: "Missing required field: id" },
      { status: 400 }
    );
  }

  const errors = validateLeagueTypeConfig(fields);
  if (errors.length > 0) {
    return Response.json(
      { error: "Invalid config", details: errors },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();
    const doc = await LeagueTypeConfigModel.findByIdAndUpdate(
      id,
      { $set: fields },
      { new: true }
    ).lean();
    if (!doc) {
      return Response.json({ error: "Config not found" }, { status: 404 });
    }
    return Response.json({ config: doc });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to update league type config:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleDelete(body: Record<string, unknown>) {
  const { id } = body;
  if (!id || typeof id !== "string") {
    return Response.json(
      { error: "Missing required field: id" },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();
    const doc = await LeagueTypeConfigModel.findByIdAndDelete(id);
    if (!doc) {
      return Response.json({ error: "Config not found" }, { status: 404 });
    }
    // Unlink from any leagues still pointing to this config
    await LeagueModel.updateMany(
      { leagueTypeConfig: id },
      { $set: { leagueTypeConfig: null } }
    );
    return Response.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to delete league type config:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
