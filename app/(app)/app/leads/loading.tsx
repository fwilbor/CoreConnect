import { Bone, SkeletonPage } from "../skeleton";

// The board: a row of columns with a few cards each.
export default function Loading() {
  return (
    <SkeletonPage wide>
      <div className="flex items-center gap-3">
        <Bone className="h-8 w-28" />
        <Bone className="h-8 w-32" />
        <Bone className="ml-auto h-9 w-24" />
      </div>
      <Bone className="mt-4 h-10" />
      <div className="mt-4 flex gap-3 overflow-hidden">
        {[3, 2, 2, 1, 1].map((cards, i) => (
          <div key={i} className="w-72 shrink-0 rounded-lg bg-neutral-100 p-2 dark:bg-neutral-900">
            <Bone className="h-4 w-24" />
            {Array.from({ length: cards }, (_, j) => <Bone key={j} className="mt-2 h-20" />)}
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
