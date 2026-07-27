import { CareerSeason } from "./CareerSeason";

export const dynamic = "force-dynamic";

export default async function CareerSeasonPage({
  searchParams,
}: {
  searchParams: Promise<{ cohortId?: string }>;
}) {
  const { cohortId } = await searchParams;
  return <CareerSeason cohortId={cohortId} />;
}
