# Targeting

Describe a control using ordered candidates. Prefer user-visible identity and
stable relationships over position or generated markup.

Candidate order:

1. accessible role and name;
2. associated label;
3. stable visible text;
4. a relationship to a stable page, section, row, or column anchor;
5. a target-profile selector grounded in the pinned application version.

Require exactly one match. Zero matches are a missing target; multiple matches are
an ambiguous target. Neither condition permits an arbitrary first match.

Match changing tables by business identity rather than row position. Re-resolve
targets after navigation, sorting, filtering, or repopulation instead of retaining
element handles.
