"use client";

/**
 * The week's Top 10 as a filterable table.
 *
 * Filter chrome follows the Patch provider portal: a search field with a
 * clear control, uppercase kickers, pill chips, and a searchable dropdown
 * for the long country list. Tokens stay Streamlens (`--ink`, `--line`,
 * `--wash`) rather than Patch's own names.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { TitleLink } from "@/components/title-link";
import { commas, num, str, type Row } from "@/lib/api";

import { SortableTable } from "./sortable-table";

type RankFilter = "all" | "1" | "top3";

function SearchIcon() {
  return (
    <svg
      className="filter-search-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <circle cx="6.75" cy="6.75" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.2 10.2L13.4 13.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="filter-chevron" viewBox="0 0 12 8" fill="none" aria-hidden>
      <path
        d="M1 1.5L6 6.5L11 1.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`filter-chip${active ? " on" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function CountryMenu({
  value,
  countries,
  onChange,
}: {
  value: string;
  countries: string[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      return;
    }
    search.current?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hits = countries.filter((name) =>
    name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="filter-drop" ref={root}>
      <button
        type="button"
        className={`filter-drop-btn${value ? " on" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{value || "All countries"}</span>
        <Chevron />
      </button>
      {open && (
        <div className="filter-menu" role="listbox">
          <div className="filter-menu-search">
            <SearchIcon />
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a country…"
              aria-label="Find a country"
            />
          </div>
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={`filter-menu-item${!value ? " on" : ""}`}
            onClick={() => pick("")}
          >
            All countries
          </button>
          {hits.length === 0 ? (
            <p className="filter-menu-empty">No countries match.</p>
          ) : (
            hits.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={value === name}
                className={`filter-menu-item${value === name ? " on" : ""}`}
                onClick={() => pick(name)}
              >
                {name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function PlacementsTable({ rows }: { rows: Row[] }) {
  const [titleQ, setTitleQ] = useState("");
  const [country, setCountry] = useState("");
  const [rank, setRank] = useState<RankFilter>("all");

  const countries = useMemo(
    () =>
      [...new Set(rows.map((r) => str(r.country_name)))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  useEffect(() => {
    if (country && !countries.includes(country)) setCountry("");
  }, [countries, country]);

  const filtered = useMemo(() => {
    const t = titleQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (country && str(r.country_name) !== country) return false;
      if (t && !str(r.title).toLowerCase().includes(t)) return false;
      const place = num(r.rank);
      if (rank === "1" && place !== 1) return false;
      if (rank === "top3" && place > 3) return false;
      return true;
    });
  }, [rows, titleQ, country, rank]);

  const dirty = titleQ !== "" || country !== "" || rank !== "all";
  const rankNote =
    rank === "1" ? "#1" : rank === "top3" ? "top 3" : null;

  return (
    <div className="placements">
      <div className="filter-bar">
        <div className="filter-search">
          <SearchIcon />
          <input
            value={titleQ}
            onChange={(e) => setTitleQ(e.target.value)}
            placeholder="Search titles…"
            aria-label="Search titles"
          />
          {titleQ && (
            <button
              type="button"
              className="filter-search-clear"
              aria-label="Clear search"
              onClick={() => setTitleQ("")}
            >
              ×
            </button>
          )}
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <span className="filter-kicker">Rank</span>
            <div className="filter-chips">
              <FilterChip
                active={rank === "all"}
                onClick={() => setRank("all")}
              >
                All
              </FilterChip>
              <FilterChip
                active={rank === "1"}
                onClick={() => setRank(rank === "1" ? "all" : "1")}
              >
                #1
              </FilterChip>
              <FilterChip
                active={rank === "top3"}
                onClick={() => setRank(rank === "top3" ? "all" : "top3")}
              >
                Top 3
              </FilterChip>
            </div>
          </div>
          <div className="filter-rule" aria-hidden />
          <div className="filter-group">
            <span className="filter-kicker">Country</span>
            <CountryMenu
              value={country}
              countries={countries}
              onChange={setCountry}
            />
          </div>
        </div>

        <div className="filter-meta">
          <p>
            {`${commas(filtered.length)} of ${commas(rows.length)} placements`}
            {rankNote && (
              <>
                <span className="filter-dot">·</span>
                {rankNote}
              </>
            )}
            {country && (
              <>
                <span className="filter-dot">·</span>
                {country}
              </>
            )}
          </p>
          {dirty && (
            <button
              type="button"
              className="filter-reset"
              onClick={() => {
                setTitleQ("");
                setCountry("");
                setRank("all");
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <SortableTable
        rows={filtered}
        initialSort="country_name"
        initialDir="asc"
        empty="No placements match that filter."
        maxHeight="28rem"
        columns={[
          { key: "country_name", label: "Country" },
          {
            key: "rank",
            label: "Rank",
            align: "right",
            render: (r) =>
              num(r.rank) === 1 ? (
                <span className="chip">#1</span>
              ) : (
                `#${num(r.rank)}`
              ),
          },
          {
            key: "title",
            label: "Title",
            render: (r) => <TitleLink title={str(r.title)} />,
          },
          { key: "weeks_charted", label: "Weeks", align: "right" },
        ]}
      />
    </div>
  );
}
