import { Bone, SkeletonPage } from "../../skeleton";

// A lead: contact card and panels on the left, composer and timeline on the right.
export default function Loading() {
  return (
    <SkeletonPage>
      <Bone className="h-4 w-20" />
      <Bone className="mt-3 h-8 w-56" />
      <Bone className="mt-2 h-4 w-72" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Bone className="h-44" />
          <Bone className="h-28" />
        </div>
        <div className="space-y-4">
          <Bone className="h-36" />
          {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-14" />)}
        </div>
      </div>
    </SkeletonPage>
  );
}
