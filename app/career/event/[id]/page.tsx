import { CareerEvent } from "./CareerEvent";

export const dynamic = "force-dynamic";

export default async function CareerEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CareerEvent eventId={id} />;
}
