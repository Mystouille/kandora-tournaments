import { GlossaryTermModel } from "~/core/models/portal/GlossaryTerm";
import { connectToDatabase } from "~/utils/dbConnection.server";

/** Public glossary list consumed by GlossaryProvider. */
export async function loader() {
  await connectToDatabase();
  const terms = await GlossaryTermModel.find().sort({ name: 1 }).lean();
  return Response.json({ terms });
}
