"use client";
import { CloudUpload } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import type { ConnectionDto } from "@/lib/connectors";
import { useT } from "@/lib/i18n-client";

type Props = {
  /** Kết nối đích (đã lọc: dùng được và hỗ trợ thao tác). */
  connections: ConnectionDto[];
  label: string;
  onPush: (connection: ConnectionDto) => void;
  testId?: string;
  /** Chưa tải xong danh sách kết nối. */
  loading?: boolean;
};

/**
 * Mục menu "Lưu vào NotebookLM" / "Đẩy nguồn sang NotebookLM": một đích → mục thường; nhiều đích → menu con theo nhãn kết nối;
 * không có đích dùng được → mục bị vô hiệu hoá kèm lý do (không bao giờ giả vờ thành công).
 */
export function PushMenuItems({ connections, label, onPush, testId, loading }: Props) {
  const t = useT();
  if (connections.length === 0) {
    return (
      <DropdownMenuItem disabled title={loading ? undefined : t("connectors.push.none")} data-testid={testId}>
        <CloudUpload /> {label}
      </DropdownMenuItem>
    );
  }
  if (connections.length === 1) {
    return (
      <DropdownMenuItem onSelect={() => onPush(connections[0])} data-testid={testId}>
        <CloudUpload /> {label}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid={testId}>
        <CloudUpload /> {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {connections.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => onPush(c)} data-testid="push-target">
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
