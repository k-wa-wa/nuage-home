// golden テストの補助。
//
// 出力そのものを、テストファイルの隣の testdata/<name>.golden に固定し、
// 文面を触ったときに意図しない差分が出ていないかを見る。更新は UPDATE_GOLDEN=1 で行う。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/** `const golden = goldenIn(import.meta.url)` の形で、テストファイルごとに使う。 */
export function goldenIn(testFileUrl: string): (name: string, actual: string) => void {
  const dir = join(dirname(fileURLToPath(testFileUrl)), "testdata");
  return (name, actual) => {
    const path = join(dir, `${name}.golden`);
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, actual, "utf8");
      return;
    }
    expect(actual).toBe(readFileSync(path, "utf8"));
  };
}
