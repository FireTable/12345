import nextEnv from "@next/env";

const { loadEnvConfig } = (nextEnv as any).default || nextEnv;
loadEnvConfig(process.cwd());

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { ticketsTable } from "../db/schema";
import { desensitizeContent } from "../backend/anonymizer";

async function main() {
  const rows = await db
    .select({
      id: ticketsTable.id,
      ticketNo: ticketsTable.ticketNo,
      content: ticketsTable.content,
      maskedContent: ticketsTable.maskedContent,
      citizenName: ticketsTable.citizenName,
      citizenPhone: ticketsTable.citizenPhone,
    })
    .from(ticketsTable);

  let updated = 0;
  let unchanged = 0;

  for (const r of rows) {
    const next = desensitizeContent(r.content || "");
    if (r.maskedContent === next) {
      unchanged++;
      continue;
    }
    await db.update(ticketsTable).set({ maskedContent: next }).where(eq(ticketsTable.id, r.id));
    updated++;
  }

  const sample = rows[0]
    ? (
        await db
          .select({
            ticketNo: ticketsTable.ticketNo,
            content: ticketsTable.content,
            maskedContent: ticketsTable.maskedContent,
            citizenName: ticketsTable.citizenName,
            citizenPhone: ticketsTable.citizenPhone,
          })
          .from(ticketsTable)
          .where(eq(ticketsTable.id, rows[0].id))
          .limit(1)
      )[0]
    : null;

  console.log(
    JSON.stringify(
      {
        total: rows.length,
        updated,
        unchanged,
        sample: sample
          ? {
              ticketNo: sample.ticketNo,
              originalPreserved: sample.content !== sample.maskedContent || !/[1-9]\d{10,}/.test(sample.content || ""),
              staffName: sample.citizenName,
              staffPhone: sample.citizenPhone,
              contentPreview: (sample.content || "").slice(0, 80),
              maskedPreview: (sample.maskedContent || "").slice(0, 80),
            }
          : null,
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
