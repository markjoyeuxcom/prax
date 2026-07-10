-- Repo-URL project detection: a project can carry the URL of the repository it
-- corresponds to, so the prax CLI (and skills) can auto-detect the project from
-- the local git remote instead of guessing from the folder name. Stored AS
-- ENTERED for display; matching normalizes both sides in JS (server/repoUrl.js)
-- at lookup time, so no normalized twin column and no uniqueness constraint —
-- duplicates resolve deterministically by sort order. Nullable — most projects
-- have no repo.
alter table projects add column repo_url text;
