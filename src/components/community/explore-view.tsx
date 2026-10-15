"use client";
import { Heart, Loader2, Lock, MessageSquare, Plus, Search, UsersRound, BookOpen, Globe } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CreateGroupDialog } from "@/components/community/create-group-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { NativeSelect } from "@/components/studio/native-select";
import { STUDIO_TYPES, TYPE_ICONS, TYPE_NAME_KEY } from "@/components/studio/type-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import type { ExploreArtifactDto, ExploreNotebookDto, ExploreSort, GroupSummaryDto, Paged } from "@/lib/community";
import { formatRelative } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n-client";
import { DEFAULT_COVER_COLOR } from "@/lib/notebook-colors";
import type { ArtifactTypeName } from "@/lib/artifacts/content";

export type ExploreTab = "artifacts" | "notebooks" | "groups";
const TABS: ExploreTab[] = ["artifacts", "notebooks", "groups"];

type ListState<T> = { items: T[]; page: number; hasMore: boolean; loading: boolean; error: boolean };

/** Danh sách phân trang theo bộ lọc: đổi bộ lọc → tải lại từ trang 1; "Tải thêm" nối trang kế. */
function usePagedList<T>(endpoint: string, params: Record<string, string>) {
  const [state, setState] = useState<ListState<T>>({ items: [], page: 0, hasMore: false, loading: true, error: false });
  const key = endpoint + JSON.stringify(params);
  const seq = useRef(0);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      if (!endpoint) return;
      const id = ++seq.current;
      setState((s) => ({ ...s, loading: true, error: false, ...(append ? {} : { items: [], page: 0 }) }));
      const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)), page: String(page) });
      try {
        const res = await api<Paged<T>>(`${endpoint}?${qs.toString()}`);
        if (id !== seq.current) return;
        setState((s) => ({ items: append ? [...s.items, ...res.items] : res.items, page: res.page, hasMore: res.hasMore, loading: false, error: false }));
      } catch {
        if (id === seq.current) setState((s) => ({ ...s, loading: false, error: true }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` đại diện cho endpoint + params
    [key],
  );

  useEffect(() => {
    void fetchPage(1, false);
  }, [fetchPage]);

  return { ...state, loadMore: () => fetchPage(state.page + 1, true), reload: () => fetchPage(1, false) };
}

function LoadMore({ list, t }: { list: { hasMore: boolean; loading: boolean; error: boolean; loadMore: () => void }; t: ReturnType<typeof useT> }) {
  if (list.error) {
    return (
      <p className="py-4 text-center text-sm text-destructive" role="alert">
        {t("community.loadError")}
      </p>
    );
  }
  if (!list.hasMore) return null;
  return (
    <div className="flex justify-center py-4">
      <Button variant="outline" onClick={list.loadMore} disabled={list.loading} data-testid="explore-load-more">
        {list.loading && <Loader2 className="animate-spin" />} {t("community.loadMore")}
      </Button>
    </div>
  );
}

function CardSkeletons() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i}>
          <Skeleton className="h-36 w-full rounded-xl" />
        </li>
      ))}
    </ul>
  );
}

function ArtifactCard({ a }: { a: ExploreArtifactDto }) {
  const t = useT();
  const { locale } = useLocale();
  const Icon = TYPE_ICONS[a.type];
  return (
    <Link href={`/a/${a.id}`} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="explore-artifact-card">
      <Card className="h-full gap-3 p-4 transition-shadow group-hover:shadow-md">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-medium leading-snug">{a.title}</h3>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              {a.notebook ? <BookOpen className="size-3 shrink-0" aria-hidden /> : <Lock className="size-3 shrink-0" aria-hidden />}
              <span className="truncate">{a.notebook ? a.notebook.title : t("community.card.privateNotebook")}</span>
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {t(TYPE_NAME_KEY[a.type])}
          </Badge>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <UserAvatar name={a.author.name} image={a.author.image} className="size-5" />
            <span className="truncate">{a.author.name}</span>
          </span>
          <time dateTime={a.createdAt}>{formatRelative(a.createdAt, locale)}</time>
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1" aria-label={t("community.card.likes", { count: a.likeCount })}>
              <Heart className="size-3.5" aria-hidden /> {a.likeCount}
            </span>
            <span className="flex items-center gap-1" aria-label={t("community.card.comments", { count: a.commentCount })}>
              <MessageSquare className="size-3.5" aria-hidden /> {a.commentCount}
            </span>
          </span>
        </div>
      </Card>
    </Link>
  );
}

function NotebookCard({ n }: { n: ExploreNotebookDto }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <Link href={`/p/${n.slug}`} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="explore-notebook-card">
      <Card className="h-full gap-0 overflow-hidden p-0 transition-shadow group-hover:shadow-md">
        <div className="flex h-16 items-end px-4 pb-2 text-2xl" style={{ backgroundColor: n.coverColor ?? DEFAULT_COVER_COLOR }}>
          <span aria-hidden>{n.emoji ?? "📓"}</span>
        </div>
        <div className="space-y-2 p-4">
          <h3 className="line-clamp-1 font-medium">{n.title}</h3>
          <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{n.description}</p>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{t("community.card.owner", { name: n.ownerName })}</span>
            <span className="shrink-0">{t("community.card.publicArtifacts", { count: n.publicArtifactCount })}</span>
          </div>
          <p className="text-xs text-muted-foreground">{formatRelative(n.updatedAt, locale)}</p>
        </div>
      </Card>
    </Link>
  );
}

function GroupCard({ g }: { g: GroupSummaryDto }) {
  const t = useT();
  return (
    <Link href={`/g/${g.slug}`} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="explore-group-card">
      <Card className="h-full gap-3 p-4 transition-shadow group-hover:shadow-md">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UsersRound className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-1 font-medium">{g.name}</h3>
            <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{g.description}</p>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("community.card.members", { count: g.memberCount })}</span>
          <span aria-hidden>·</span>
          <span>{t("community.card.notebooks", { count: g.notebookCount })}</span>
          <span className="ml-auto flex items-center gap-1.5">
            {g.visibility === "private" ? <Lock className="size-3.5" aria-label={t("community.group.visibility.private")} /> : <Globe className="size-3.5" aria-label={t("community.group.visibility.public")} />}
            {g.myRole && <Badge variant="outline">{t("community.card.joined")}</Badge>}
          </span>
        </div>
      </Card>
    </Link>
  );
}

function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Khám phá cộng đồng: tab artifact / sổ tay / nhóm công khai, có tìm kiếm, lọc và phân trang. */
export function ExploreView({ initialTab }: { initialTab: ExploreTab }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<ExploreTab>(initialTab);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ArtifactTypeName | "">("");
  const [sort, setSort] = useState<ExploreSort>("new");
  const [createOpen, setCreateOpen] = useState(false);
  const q = useDebounced(search.trim());

  function changeTab(next: string) {
    const nt = TABS.includes(next as ExploreTab) ? (next as ExploreTab) : "artifacts";
    setTab(nt);
    router.replace(nt === "artifacts" ? pathname : `${pathname}?tab=${nt}`, { scroll: false });
  }

  const artifacts = usePagedList<ExploreArtifactDto>(tab === "artifacts" ? "/api/explore/artifacts" : "", { q, type, sort });
  const notebooks = usePagedList<ExploreNotebookDto>(tab === "notebooks" ? "/api/explore/notebooks" : "", { q });
  const groups = usePagedList<GroupSummaryDto>(tab === "groups" ? "/api/explore/groups" : "", { q });

  const hasFilter = Boolean(q || type);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("community.explore.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("community.explore.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList className="h-auto flex-wrap">
            {TABS.map((k) => (
              <TabsTrigger key={k} value={k} data-testid={`explore-tab-${k}`}>
                {t(`community.tab.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("community.filter.search")} aria-label={t("community.filter.search")} className="pl-8" data-testid="explore-search" />
          </div>
          {tab === "artifacts" && (
            <>
              <NativeSelect value={type} onChange={(e) => setType(e.target.value as ArtifactTypeName | "")} aria-label={t("community.filter.type")} data-testid="explore-type">
                <option value="">{t("community.filter.allTypes")}</option>
                {STUDIO_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t(TYPE_NAME_KEY[k])}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as ExploreSort)} aria-label={t("community.filter.sort")} data-testid="explore-sort">
                <option value="new">{t("community.sort.new")}</option>
                <option value="likes">{t("community.sort.likes")}</option>
              </NativeSelect>
            </>
          )}
          {tab === "groups" && (
            <Button onClick={() => setCreateOpen(true)} data-testid="explore-create-group">
              <Plus /> {t("community.group.create")}
            </Button>
          )}
        </div>
      </div>

      {tab === "artifacts" && (
        <ListBody list={artifacts} t={t} empty={{ icon: Globe, title: "community.empty.artifacts.title", description: "community.empty.artifacts.description" }} hasFilter={hasFilter}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="explore-artifacts">
            {artifacts.items.map((a) => (
              <li key={a.id}>
                <ArtifactCard a={a} />
              </li>
            ))}
          </ul>
        </ListBody>
      )}
      {tab === "notebooks" && (
        <ListBody list={notebooks} t={t} empty={{ icon: BookOpen, title: "community.empty.notebooks.title", description: "community.empty.notebooks.description" }} hasFilter={hasFilter}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="explore-notebooks">
            {notebooks.items.map((n) => (
              <li key={n.id}>
                <NotebookCard n={n} />
              </li>
            ))}
          </ul>
        </ListBody>
      )}
      {tab === "groups" && (
        <ListBody list={groups} t={t} empty={{ icon: UsersRound, title: "community.empty.groups.title", description: "community.empty.groups.description" }} hasFilter={hasFilter}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="explore-groups">
            {groups.items.map((g) => (
              <li key={g.id}>
                <GroupCard g={g} />
              </li>
            ))}
          </ul>
        </ListBody>
      )}

      <CreateGroupDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(slug) => {
          toast.success(t("community.group.created"));
          router.push(`/g/${slug}`);
        }}
      />
    </div>
  );
}

type EmptySpec = { icon: typeof Globe; title: "community.empty.artifacts.title" | "community.empty.notebooks.title" | "community.empty.groups.title"; description: "community.empty.artifacts.description" | "community.empty.notebooks.description" | "community.empty.groups.description" };

function ListBody<T>({ list, t, empty, hasFilter, children }: { list: ListState<T> & { loadMore: () => void }; t: ReturnType<typeof useT>; empty: EmptySpec; hasFilter: boolean; children: React.ReactNode }) {
  if (list.loading && list.items.length === 0) return <CardSkeletons />;
  if (list.error && list.items.length === 0) {
    return <EmptyState icon={Search} title={t("community.loadError")} className="py-16" />;
  }
  if (list.items.length === 0) {
    return hasFilter ? (
      <EmptyState icon={Search} title={t("community.empty.noMatch")} className="py-16" />
    ) : (
      <EmptyState icon={empty.icon} title={t(empty.title)} description={t(empty.description)} className="rounded-xl border border-dashed py-16" />
    );
  }
  return (
    <>
      {children}
      <LoadMore list={list} t={t} />
    </>
  );
}
