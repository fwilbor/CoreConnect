import { Bone, SkeletonPage } from "../skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="flex items-center justify-between">
        <Bone className="h-8 w-40" />
        <Bone className="h-8 w-60" />
      </div>
      <Bone className="mt-5 h-40 rounded-xl" />
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Bone key={i} className="h-36 rounded-xl" />)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => <Bone key={i} className="h-80 rounded-xl" />)}
      </div>
    </SkeletonPage>
  );
}
