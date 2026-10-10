/**
 * 旁路表是 halfvec(1024)，主键是工单 id，删工单级联删除。
 * 镜像是带 pgvector 的 Postgres 16。能拉起一次性容器时，再跑一条余弦排序。
 * 不碰正在使用的 12345-postgres，也不挂 pgdata。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ticketEmbeddingsTable, ticketsTable } from "../db/schema";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

function column(name: string) {
  return getTableConfig(ticketEmbeddingsTable).columns.find((item) => item.name === name);
}

function main() {
  const config = getTableConfig(ticketEmbeddingsTable);
  assert(config.name === "ticket_embeddings", "旁路表名是 ticket_embeddings");
  assert(column("embedding")?.getSQLType() === "halfvec(1024)", "嵌入列是 halfvec(1024)");
  assert(column("ticket_id")?.primary === true, "工单 id 是主键");
  assert(column("product_hash")?.notNull === true, "抽取产物哈希非空");
  assert(column("model")?.default === "BAAI/bge-m3", "模型字面量默认是 BAAI/bge-m3");
  assert(column("embedded_at")?.notNull === true, "嵌入时间非空");
  const foreignKey = config.foreignKeys[0];
  const reference = foreignKey?.reference();
  assert(
    config.foreignKeys.length === 1 &&
      foreignKey?.onDelete === "cascade" &&
      reference?.columns[0]?.name === "ticket_id" &&
      reference?.foreignColumns[0]?.name === "id",
    "删工单时级联删除这一行"
  );
  assert(
    config.indexes.every((index) => !/hnsw/i.test(index.config.name || "")),
    "Drizzle 表定义里不建 HNSW"
  );
  const ticketColumns = getTableConfig(ticketsTable).columns.map((item) => item.name);
  assert(
    !ticketColumns.includes("embedding") && !ticketColumns.includes("product_hash"),
    "工单主表不加向量列和哈希列"
  );

  const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
  assert(compose.includes("image: pgvector/pgvector:pg16"), "Postgres 16 镜像带 pgvector");
  assert(compose.includes("pgdata:/var/lib/postgresql/data"), "数据卷仍挂 pgdata，不换卷");

  const manager = readFileSync(path.join(root, "lib/tenant/schema-manager.ts"), "utf8");
  assert(manager.includes("embedding halfvec(1024) NOT NULL"), "租户建表使用 halfvec(1024)");
  assert(manager.includes("REFERENCES tickets(id) ON DELETE CASCADE"), "租户建表级联删除");
  assert(manager.includes("DEFAULT 'BAAI/bge-m3'"), "租户建表模型默认是 BAAI/bge-m3");
  assert(manager.includes("embedded_at TIMESTAMP WITH TIME ZONE"), "租户建表有嵌入时间");
  assert(manager.includes("CREATE EXTENSION IF NOT EXISTS vector"), "租户初始化创建 vector 扩展");
  assert(!/USING\s+hnsw/i.test(manager), "租户建表不建 HNSW");

  if (process.exitCode) return;
  runThrowawayCosine();
}

function run(command: string, args: string[], timeout: number) {
  return spawnSync(command, args, { encoding: "utf8", timeout });
}

function clip(text: string): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > 400 ? value.slice(0, 400) : value;
}

function runThrowawayCosine() {
  const name = `civic-embed-schema-${process.pid}`;
  if (name === "12345-postgres") return;
  const probe = run("docker", ["version", "--format", "{{.Server.Version}}"], 15000);
  if (probe.status !== 0) {
    console.log(`DOCKER_START_FAILED ${clip(probe.stderr || probe.error?.message || "docker version failed")}`);
    return;
  }

  run("docker", ["rm", "-f", name], 20000);
  const started = run(
    "docker",
    [
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "civic-embed-schema-check=1",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_USER=postgres",
      "-e",
      "POSTGRES_DB=embedcheck",
      "pgvector/pgvector:pg16",
    ],
    180000
  );
  if (started.status !== 0) {
    console.log(`DOCKER_START_FAILED ${clip(started.stderr || started.stdout || started.error?.message || "docker run failed")}`);
    run("docker", ["rm", "-f", name], 20000);
    return;
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      const ping = run("docker", ["exec", name, "pg_isready", "-U", "postgres", "-d", "embedcheck"], 10000);
      if (ping.status === 0) {
        ready = true;
        break;
      }
      run("sleep", ["1"], 5000);
    }
    if (!ready) {
      console.log("DOCKER_START_FAILED pg_isready timed out");
      return;
    }

    const sql = [
      "CREATE EXTENSION IF NOT EXISTS vector;",
      "CREATE TABLE ticket_embeddings (ticket_id varchar(64) primary key, embedding halfvec(1024) not null);",
      "INSERT INTO ticket_embeddings (ticket_id, embedding) VALUES",
      "('far', ('[' || '0,1' || repeat(',0', 1022) || ']')::halfvec(1024)),",
      "('near', ('[' || '1' || repeat(',0', 1023) || ']')::halfvec(1024));",
      "SELECT ticket_id FROM ticket_embeddings",
      "ORDER BY embedding <=> ('[' || '1' || repeat(',0', 1023) || ']')::halfvec(1024);",
    ].join(" ");
    const query = run(
      "docker",
      ["exec", name, "psql", "-U", "postgres", "-d", "embedcheck", "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
      30000
    );
    const order = (query.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (query.status !== 0) {
      console.error(`FAIL 余弦查询没有跑成：${clip(query.stderr || query.stdout || "psql failed")}`);
      process.exitCode = 1;
      return;
    }
    assert(order[0] === "near" && order[1] === "far", `halfvec 余弦近的排在前面，实际 ${order.join(",")}`);
  } finally {
    run("docker", ["rm", "-f", name], 20000);
  }
}

main();
