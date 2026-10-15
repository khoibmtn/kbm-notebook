/** Hằng số k của Reciprocal Rank Fusion (giá trị chuẩn 60). */
export const RRF_K = 60;

export type Ranked<T> = { item: T; score: number; ranks: (number | null)[] };

/**
 * Reciprocal Rank Fusion: gộp nhiều danh sách đã xếp hạng (phần tử đầu = hạng 1).
 * score(d) = Σ 1 / (k + rank_i(d)) trên các danh sách chứa d. `ranks[i]` là hạng 1-based trong danh sách i (null nếu không có).
 * Kết quả giảm dần theo score; hòa điểm giữ thứ tự xuất hiện sớm hơn.
 */
export function rrfMerge<T>(lists: T[][], key: (item: T) => string, k = RRF_K): Ranked<T>[] {
  const map = new Map<string, Ranked<T> & { order: number }>();
  let order = 0;
  lists.forEach((list, li) => {
    list.forEach((item, i) => {
      const id = key(item);
      let entry = map.get(id);
      if (!entry) {
        entry = { item, score: 0, ranks: lists.map(() => null), order: order++ };
        map.set(id, entry);
      }
      entry.score += 1 / (k + i + 1);
      entry.ranks[li] = i + 1;
    });
  });
  return [...map.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ item, score, ranks }) => ({ item, score, ranks }));
}
