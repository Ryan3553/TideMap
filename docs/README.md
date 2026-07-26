# docs/ — everything an agent needs

Point a new session at this folder. Read in this order.

## Always

| # | doc | what it gives you |
|---|---|---|
| 1 | **[HANDOVER.md](HANDOVER.md)** | Where the project stands, the three diagnosed defects with measurements, and what not to touch. **The most important file here.** |
| 2 | **[CONCEPT.md](CONCEPT.md)** | What the piece *is* and the rulings behind it — north stays up, artwork not utility, why the damp band exists. Stops settled decisions being re-litigated. |
| 3 | **[NEXT-SESSION.md](NEXT-SESSION.md)** | Kickoff prompt, per-job reading list, acceptance criteria, and the environment traps that have already cost time once. |

Those three are short and worth reading in full.

## On demand

| doc | read it when | size |
|---|---|---|
| [SOURCES.md](SOURCES.md) | touching source imagery or tide tables — how to regenerate, and the LDS-vs-Basemaps API-key trap | short |
| [pipeline-validation.md](pipeline-validation.md) | working on the drying-height raster. §5 is renderer notes, §6 the defect record | **571 lines — delegate it to a subagent rather than loading it whole** |
| [tide-validation.md](tide-validation.md) | almost never. The tide model is finished and over-specified for an artwork | 469 lines |
| [FINDINGS.md](FINDINGS.md) | historical: the original "is there even usable imagery?" question, now settled | short |

## Two notes

**`pipeline-validation.md` is generated**, by `pipeline/7-report.mjs`. Edit the generator,
not the file, or a pipeline re-run will silently overwrite you. Everything else here is
hand-written.

**Claims in these docs come with their numbers.** Where something is uncertain, unverified,
or was measured rather than assumed, it says so. If you find a claim without evidence behind
it, treat it as suspect rather than settled — that convention is the point.
