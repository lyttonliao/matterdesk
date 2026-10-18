# Regex field guide (JavaScript/TypeScript first, Postgres and grep second)

A regular expression (regex) is a pattern that describes a set of strings. You give it to an engine, and the engine answers "does this text match?" and "which part matched?". Every example below was run in Node; the outputs shown are real.

## 0. How to practice

Keep a scratch file and run it with `node regex-lab.mjs`:

```js
const t = (re, s) =>
  console.log(String(re), JSON.stringify(s), "->", s.match(re));
t(/\d{4}-\d{2}-\d{2}/, "opened 2026-10-17 ok");
```

Change the pattern, rerun. Writing a regex without running it on both a matching and a non-matching string is how bugs ship.

## 1. The 80% you need

| Syntax         | Means                                                 | Example → matches                                                   |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `abc`          | the literal text                                      | `/cat/` → "cat" in "concatenate"                                    |
| `.`            | any one character except newline                      | `/c.t/` → "cat", "cut"                                              |
| `\d` `\w` `\s` | digit, word char (`[A-Za-z0-9_]`), whitespace         | `/\d\d/` → "42"                                                     |
| `\D` `\W` `\S` | the opposites                                         |                                                                     |
| `[abc]`        | one of a, b, c                                        | `/gr[ae]y/` → "gray", "grey"                                        |
| `[a-f0-9]`     | a range                                               | hex digit                                                           |
| `[^abc]`       | anything except a, b, c                               | `/[^\s@]+/` → run of non-space, non-@                               |
| `^` `$`        | start / end of the string (or line with the `m` flag) | `/^abc$/` matches only exactly "abc"                                |
| `\b`           | word boundary (between `\w` and non-`\w`)             | `/\bcat\b/` → "cat" in "concatenate cat" matches only the last word |
| `*` `+` `?`    | 0 or more, 1 or more, 0 or 1                          | `/colou?r/`                                                         |
| `{n}` `{n,m}`  | exactly n, between n and m                            | `/\d{4}/`                                                           |
| `a\|b`         | a or b                                                | `/cat\|dog/`                                                        |
| `( )`          | group (and capture)                                   | `/(ab)+/`                                                           |
| `\`            | escape: `\.` is a literal dot                         | `/\./`                                                              |

The two mistakes everyone makes first:

1. **Forgetting to escape `.`**: `"a.b".replace(".", "-")` works (a string pattern is literal and replaces once), but `/./` matches any character. Use `/\./g`.
2. **Forgetting anchors in validation**: `/\d{4}/.test("abc12345xyz")` is `true`. To validate a whole field use `^...$`.

## 2. Flags

| Flag | Effect                                                                                    |
| ---- | ----------------------------------------------------------------------------------------- |
| `g`  | find all matches, not just the first (also makes `.test()`/`.exec()` stateful, see traps) |
| `i`  | case-insensitive                                                                          |
| `m`  | `^`/`$` match at each line, not just string ends                                          |
| `s`  | `.` also matches newline                                                                  |
| `u`  | proper Unicode handling (use it when names or non-ASCII text are possible)                |

## 3. Greedy vs lazy

Quantifiers are greedy: they take as much as they can, then give back.

```js
"<b>hi</b>".match(/<.+>/); // ['<b>hi</b>']  grabbed to the LAST >
"<b>hi</b>".match(/<.+?>/); // ['<b>']        lazy: stops at the first >
```

Better than lazy is usually a negated class: `/<[^>]+>/` says "up to the next `>`" and cannot overrun.

## 4. Groups, named groups, replace

```js
const m = "2026-10-17".match(/(?<year>\d{4})-(?<month>\d{2})/);
m.groups.year; // '2026'
m.groups.month; // '10'

"2026-10-17".replace(/(\d{4})-(\d{2})-(\d{2})/, "$3/$2/$1"); // '17/10/2026'
```

- `(...)` captures; `(?:...)` groups without capturing.
- Named groups (`(?<name>...)`) beat numbered ones as soon as there are more than two.
- In `replace`, `$1`, `$2` refer to captures; `$<name>` to named ones.

## 5. Lookaround (match based on neighbors without consuming them)

```js
"cost $450".match(/(?<=\$)\d+/)     // ['450']  preceded by $
"45% of 90".match(/\d+(?=%)/)       // ['45']   followed by %
/^(?=.*\d)(?=.*[a-z]).{8,}$/.test("abcdefg1")   // true: has a digit AND a letter, 8+ chars
```

`(?=...)` lookahead, `(?!...)` negative lookahead, `(?<=...)` lookbehind, `(?<!...)` negative lookbehind. They check and move on; the matched text does not include them.

## 6. The methods (which one to call)

| You want                | Use                                        | Returns                                 |
| ----------------------- | ------------------------------------------ | --------------------------------------- |
| yes/no                  | `re.test(s)`                               | boolean                                 |
| first match + groups    | `s.match(re)` (no `g`)                     | array with `groups`, `index`, or `null` |
| all matches, text only  | `s.match(re)` (with `g`)                   | array of strings or `null`              |
| all matches with groups | `[...s.matchAll(re)]` (needs `g`)          | iterator of match arrays                |
| replace                 | `s.replace(re, x)` / `s.replaceAll(re, x)` | new string                              |
| split                   | `s.split(re)`                              | array                                   |

```js
[..."k1=v1;k2=v2".matchAll(/(\w+)=(\w+)/g)].map((m) => [m[1], m[2]]);
// [ ['k1','v1'], ['k2','v2'] ]
```

## 7. Examples from this project

```js
// ISO date
/^\d{4}-\d{2}-\d{2}$/

// Email, deliberately loose: something@something.something with no spaces
/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test("alice@firm.test")   // true

// UUID (what z.uuid() checks for you)
/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Probate citations like "SCPA 17-A" (from the RAG module: exact terms need keyword search)
"See SCPA 17-A and SCPA 1750-b and EPTL 5-1.1".match(/\b[A-Z]{2,5} \d+-[A-Z]\b/g)
// [ 'SCPA 17-A' ]   "1750-b" is missed (lowercase b); add the i flag or [A-Za-z] if you want it
```

Do not validate real email addresses with a clever regex. The loose check above catches typos; the only real validation is sending a message to the address. Same for names and phone numbers: prefer a library, or accept more than you think.

## 8. Traps

**Stateful `g` regexes.** A regex with `g` remembers `lastIndex` between `.test()` calls:

```js
const g = /a/g;
g.test("a"); // true
g.test("a"); // false   (it resumed after the first match)
```

Either drop `g` when you only need a boolean, or create the regex inside the function instead of at module level.

**Catastrophic backtracking (ReDoS).** Nested quantifiers like `(a+)+$` try an exponential number of ways to split the input before failing. Measured on this machine, `/(a+)+$/.test("a".repeat(n) + "b")`:

| n   | time    |
| --- | ------- |
| 20  | 59 ms   |
| 24  | 138 ms  |
| 28  | 2271 ms |

Each extra character roughly doubles the work, and JavaScript runs on one thread, so one malicious request can freeze the server. Rules: never nest an unbounded quantifier inside another (`(a+)+`, `(.*)*`, `(a|aa)+`); cap lengths before running a regex on user input; prefer specific classes (`[^"]*`) over `.*`.

**Using regex where a parser belongs.** HTML, JSON, CSV, SQL, and nested brackets are not regular. Use `JSON.parse`, a CSV library, a DOM parser. Regex is for flat, local patterns.

**Interpolating user input into a regex.** `new RegExp(userInput)` lets users inject patterns (and ReDoS). Escape first:

```js
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
new RegExp(escape(userInput), "i");
```

## 9. Outside JavaScript

**PostgreSQL**

```sql
SELECT * FROM documents WHERE filename ~ '^will_.*\.pdf$';   -- ~ case-sensitive match
SELECT * FROM documents WHERE filename ~* 'estate';          -- ~* case-insensitive
SELECT * FROM documents WHERE filename !~ 'draft';           -- !~ does not match
SELECT substring(filename from '\d{4}') FROM documents;      -- first capture / match
SELECT regexp_replace(title, '\s+', ' ', 'g') FROM matters;  -- 'g' = all matches
```

A leading-wildcard or regex filter cannot use a normal B-tree index, so on a big table it is a sequential scan. For `LIKE '%x%'` or regex over large tables, the answer is a trigram index (`pg_trgm`) or full-text search.

**grep / ripgrep** (finding code, a daily-use skill)

```bash
rg 'getCurrentUser\(' src          # callers
rg -n '"use server"' src           # every Server Action file
rg -i 'todo|fixme' src             # either word, any case
rg -P '(?<=withUser\()\w+' src     # -P enables lookbehind (PCRE)
```

Shell quoting: put the pattern in single quotes so the shell does not eat `\`, `$`, `*`.

## 10. Reading a regex you did not write

Break it into pieces left to right and say each one aloud:

`/^(?<user>[^\s@]+)@(?<host>[^\s@]+)\.(?<tld>[a-z]{2,})$/i`
"Start. Capture a run of non-space, non-@ characters as `user`. A literal `@`. Capture non-space, non-@ as `host`. A literal dot. Capture 2 or more letters as `tld`. End. Case-insensitive."

Then ask the review questions: is it anchored? Can the input be huge? Is there a nested quantifier? What does `.` match here? Is the dot escaped?

## 11. Practice (write each, then test it with a matching and a non-matching string)

1. Match a US phone number in `555-867-5309` and `(555) 867-5309`.
2. Extract every `[doc, page]` citation like `[will_2019.pdf, 4]` from an answer string, giving the filename and the page as named groups.
3. Turn `2026-10-17` into `10/17/2026` with one `replace`.
4. Collapse any run of whitespace in a matter title to a single space.
5. Find all `"use server"` files in `firm/src` with `rg`.
6. Write a pattern that is vulnerable to ReDoS, time it at three input sizes, then rewrite it so it is not.

Solutions you can check by running them. If one does not behave the way you expected, bring it back here and we will work through why.
