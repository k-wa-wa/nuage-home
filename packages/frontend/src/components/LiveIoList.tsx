import type { LiveIoRecord } from "@nuage-home/shared";

export const IO_LABEL: Record<LiveIoRecord["kind"], string> = {
  user_turn: "ユーザー発話",
  context: "文脈（応答させない）",
  prompt: "読み上げ指示",
  tool_call: "ツール呼び出し",
  tool_response: "ツール応答",
};

export interface LiveIoItem {
  record: LiveIoRecord;
  at: number;
}

export interface LiveIoListProps {
  items: LiveIoItem[];
}

/**
 * Live に送受信された内容（Live IO）を表示する React コンポーネント。
 */
export function LiveIoList({ items }: LiveIoListProps) {
  if (items.length === 0) {
    return (
      <ol className="list sb-io">
        <li className="list-empty">まだない</li>
      </ol>
    );
  }

  return (
    <ol className="list sb-io">
      {items.map((item, i) => {
        const time = new Date(item.at).toLocaleTimeString("ja-JP");
        const { record } = item;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: ログ一覧のインデックスキー
          <li key={i}>
            <span className="chip" data-state={record.kind}>
              {IO_LABEL[record.kind]}
            </span>
            <span> {time} </span>
            {"text" in record && <div className="sb-io-body">{record.text}</div>}
            {record.kind === "tool_call" && (
              <div className="sb-io-body">
                {record.name} {JSON.stringify(record.args)}
              </div>
            )}
            {record.kind === "tool_response" && (
              <div className="sb-io-body">
                {record.name} {JSON.stringify(record.response)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
