import { Bone, SkeletonPage } from "./skeleton";

// Today, and any app page without its own loading state.
export default function Loading() {
  return (
    <SkeletonPage>
      <Bone className="h-8 w-40" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-24" />)}
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <Bone className="h-5 w-32" />
            <Bone className="mt-3 h-16" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
