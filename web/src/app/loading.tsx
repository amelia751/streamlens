import { Connecting } from "@/components/spinner";

/**
 * The fallback for any route that has not named its own.
 *
 * Every page here reads ClickHouse on the server, so navigation has a gap in
 * it. A skeleton of boxes guesses at a layout it may not get; saying what is
 * being waited on is both honest and shorter.
 */
export default function Loading() {
  return (
    <div className="shell">
      <Connecting />
    </div>
  );
}
