#!/usr/bin/env node
/*
 * 天気を取りに行く格子から、陸に関係ない地点を落とすための一覧を作る。
 *
 * なぜ落とすか:
 *   格子は 24〜46N / 123〜146E の長方形で552地点あるが、その多くは外洋。
 *   地図では海に色を塗っていないので、海上の予報は表示に使われない。
 *   それでも取得すれば上流の呼び出し枠を消費するだけになる。
 *
 * どこまで残すか:
 *   画面の各画素は、囲む4つの格子点から双一次補間で値を作る。
 *   つまり陸地の画素が使うのは、その画素から緯度・経度とも1度以内にある格子点。
 *   そこで「±1度の範囲に陸がある格子点」は残す。こうすれば陸の描画は
 *   落とす前とまったく同じ値になる。
 *
 * 落とした地点の扱い:
 *   キャッシュの形は変えない(552地点ぶんの配列のまま)。落とした地点には
 *   最も近い「残した地点」の値を server 側で複製して詰める。
 *   こうするとサイト側の補間の実装は一切変えなくてよく、
 *   海の上も見た目には連続したままになる(どのみち海は塗らない)。
 *
 * 陸地データ:
 *   Natural Earth 1:10m land(public domain)。1.5MBあるのでリポジトリには置かず、
 *   必要になったときに取得して一時置き場に展開する(build_lp.mjs と同じ扱い)。
 *   リポジトリに残すのは成果物である generated/grid-mask.txt(552文字)だけ。
 *
 * 使い方:
 *   node scripts/stars/land_grid.mjs            … 集計を表示する
 *   node scripts/stars/land_grid.mjs --sql      … SQL を標準出力に出す
 *   node scripts/stars/land_grid.mjs --fetch    … 陸地データを取り直す
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAND_FILE = path.join(os.tmpdir(), "stars-land-japan.geojson");
const MASK_FILE = path.join(HERE, "generated", "grid-mask.txt");

/* 天気の格子(weather-cache.sql の stars_grid_def と同じ値にすること) */
const GRID = { south: 24, north: 46, west: 123, east: 146, step: 1 };

/* 格子点を残す条件: この距離(度)以内に陸があること。補間が使う範囲と同じ */
const KEEP_RADIUS_DEG = 1;

/*
 * Natural Earth 1:10m land(public domain)。
 * 1:50m では小笠原諸島のような小さな島が落ちてしまうため、細かいほうを使う。
 * 日本は離島が多く、そこは光害が少なく星見の適地でもあるので落とせない。
 */
const SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson";

// ---- 陸地データ ---------------------------------------------------------

/** 日本周辺だけ切り出して保存する(元データは世界全体で1.6MBあるため) */
async function fetchLand() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error("陸地データを取得できません: " + res.status);
  const all = await res.json();

  // 格子より少し広めに取る(端の判定で外側の陸も要るため)
  const box = {
    west: GRID.west - 2,
    east: GRID.east + 2,
    south: GRID.south - 2,
    north: GRID.north + 2
  };

  const rings = [];
  for (const f of all.features) {
    for (const ring of ringsOf(f.geometry)) {
      const b = bboxOf(ring);
      if (b.east < box.west || b.west > box.east || b.north < box.south || b.south > box.north) {
        continue;
      }
      rings.push(ring);
    }
  }

  await mkdir(path.dirname(LAND_FILE), { recursive: true });
  await writeFile(LAND_FILE, JSON.stringify({ source: SOURCE, box, rings }));
  return rings.length;
}

/** GeoJSON の geometry から外周のリングだけを取り出す(穴は無視して差し支えない) */
function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates[0]];
  if (geom.type === "MultiPolygon") return geom.coordinates.map((p) => p[0]);
  return [];
}

function bboxOf(ring) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, east, south, north };
}

/** 点がリングの内側か(交差数判定) */
function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---- 格子の判定 ---------------------------------------------------------

async function loadRings() {
  // 置き場に無ければ取りに行く(一時置き場なので消えていることがある)
  try {
    await readFile(LAND_FILE);
  } catch (e) {
    await fetchLand();
  }
  const raw = JSON.parse(await readFile(LAND_FILE, "utf8"));
  // リングごとに外接矩形を先に持っておく(判定のほとんどはここで弾ける)
  return raw.rings.map((ring) => ({ ring, box: bboxOf(ring) }));
}

/**
 * その格子点を残すか。
 *
 * 判定は2つの合わせ技にしてある:
 *   ① ±1度の箱の中に海岸線の頂点があるか
 *      → 島や海岸線はこれで拾える。等間隔の標本だと、父島(約7km)のように
 *        標本の間隔より小さい島がすり抜けてしまうため、頂点そのものを見る。
 *   ② 格子点そのものが陸地の内側にあるか
 *      → 本州の内陸のように、海岸線から1度以上離れた点はこれで拾う。
 */
function keepPoint(rings, lat, lon) {
  const r = KEEP_RADIUS_DEG;
  for (const { ring, box } of rings) {
    // ① 箱と外接矩形が重なるリングだけ、頂点を見る
    if (!(box.west > lon + r || box.east < lon - r || box.south > lat + r || box.north < lat - r)) {
      for (const [vlon, vlat] of ring) {
        if (Math.abs(vlat - lat) <= r && Math.abs(vlon - lon) <= r) return true;
      }
    }
    // ② 内陸の判定
    if (lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north) {
      if (inRing(ring, lon, lat)) return true;
    }
  }
  return false;
}

/** 格子点の一覧(北→南・西→東の通し番号つき)。weather-cache.sql と同じ並び */
function gridPoints() {
  const out = [];
  let rn = 0;
  for (let lat = GRID.north; lat >= GRID.south; lat -= GRID.step) {
    for (let lon = GRID.west; lon <= GRID.east; lon += GRID.step) {
      out.push({ rn: ++rn, lat, lon });
    }
  }
  return out;
}

export async function build() {
  const rings = await loadRings();
  const points = gridPoints();
  const keep = [];
  for (const p of points) {
    p.fetched = keepPoint(rings, p.lat, p.lon);
    if (p.fetched) keep.push(p);
  }

  // 落とした地点には、最も近い「残した地点」の値を複製する
  keep.forEach((p, i) => {
    p.pos = i + 1; // 取得する配列の中での位置(1始まり)
  });
  for (const p of points) {
    if (p.fetched) {
      p.srcPos = p.pos;
      continue;
    }
    let best = null;
    let bestD = Infinity;
    for (const k of keep) {
      const d = (k.lat - p.lat) ** 2 + (k.lon - p.lon) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    p.srcPos = best.pos;
  }

  return { points, keep, rings };
}

/**
 * 線分が通り抜ける格子のマスを、取りこぼしなく列挙する。
 *
 * 端点だけを見ると足りない。たとえば (35.9,136.1) から (35.9,138.9) への
 * 1本の線分は、136〜137・137〜138・138〜139 の3マスを通るが、
 * 端点が入っているのは両端の2マスだけで、真ん中のマスは見落とす。
 *
 * 緯度・経度が整数をまたぐ位置をすべて求め、隣り合う交点の中点を取る。
 * 中点は必ずどれか1つのマスの内側にあるので、これでマスが漏れなく挙がる。
 */
function cellsCrossed(latA, lonA, latB, lonB) {
  const ts = [0, 1];
  const crossings = (a, b) => {
    if (a === b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let v = Math.ceil(lo); v <= Math.floor(hi); v++) {
      const t = (v - a) / (b - a);
      if (t > 0 && t < 1) ts.push(t);
    }
  };
  crossings(latA, latB);
  crossings(lonA, lonB);
  ts.sort((x, y) => x - y);

  const cells = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t = (ts[i] + ts[i + 1]) / 2;
    const lat = latA + (latB - latA) * t;
    const lon = lonA + (lonB - lonA) * t;
    cells.push([Math.floor(lat), Math.floor(lon)]);
  }
  return cells;
}

/**
 * 陸の描画が落とす前とまったく同じになることを確かめる。
 *
 * 画面の1画素は、それを囲む4つの格子点から双一次補間で作られる。
 * したがって「陸のどの位置についても、それを囲む4点がすべて残っている」なら、
 * 陸の値は落とす前と1つも変わらない。
 *
 * 見るのは海岸線の全線分。以前は頂点だけを見ていたが、それでは
 * 長い線分が横切る途中のマスを見落とす(上の cellsCrossed の説明を参照)。
 * Natural Earth の 1:10m は頂点が密なので実際に見落としは無かったが、
 * 「たまたま無かった」と「無いことを確かめた」は別物なので線分で見る。
 *
 * 海岸線は陸の縁そのもの ── 陸の中でいちばん外側=危ない側を突いている。
 */
export function verifyLandUnaffected(points, rings) {
  const kept = new Set();
  for (const p of points) if (p.fetched) kept.add(`${p.lat},${p.lon}`);

  const inGrid = (lat, lon) =>
    lat >= GRID.south && lat <= GRID.north && lon >= GRID.west && lon <= GRID.east;

  let segments = 0;
  let cells = 0;
  const seen = new Set();
  const bad = [];

  for (const { ring } of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [lonA, latA] = ring[i];
      const [lonB, latB] = ring[i + 1];
      // 両端とも格子の外なら、その線分は対象外
      if (!inGrid(latA, lonA) && !inGrid(latB, lonB)) continue;
      segments++;

      for (const [la, lo] of cellsCrossed(latA, lonA, latB, lonB)) {
        const key = `${la},${lo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells++;

        // そのマスの4隅がすべて残っているか
        for (const cla of [la, la + 1]) {
          for (const clo of [lo, lo + 1]) {
            if (!inGrid(cla, clo)) continue;
            if (!kept.has(`${cla},${clo}`)) {
              bad.push(`マス(${la},${lo}) の隅(${cla},${clo}) が無い`);
            }
          }
        }
      }
    }
  }
  return { segments, cells, bad: bad.slice(0, 5), badCount: bad.length };
}

/**
 * 取りに行く地点を552文字の並びで表す(北→南・西→東の順、1=取りに行く)。
 * iPhone から貼り付けるので、552行の INSERT ではなく1行に畳む。
 * 落とした地点の複製元は、この並びから SQL 側で計算する(stars_grid_build)。
 */
function toMask(points) {
  return points.map((p) => (p.fetched ? "1" : "0")).join("");
}

function toSql(points, keep) {
  const rows = points
    .map((p) => `(${p.rn},${p.lat},${p.lon},${p.fetched},${p.srcPos})`)
    .join(",\n  ");
  return `-- scripts/stars/land_grid.mjs が生成。手で編集しないこと。
-- 全 ${points.length} 地点のうち、上流へ取りに行くのは ${keep.length} 地点。
-- 残りは最も近い取得地点の値を複製する(海は地図に描かないので影響しない)。
create table if not exists public.stars_grid_cells (
  rn      int primary key,
  lat     int not null,
  lon     int not null,
  fetched boolean not null,
  src_pos int not null
);

alter table public.stars_grid_cells enable row level security;
revoke all on table public.stars_grid_cells from anon, authenticated;

truncate table public.stars_grid_cells;
insert into public.stars_grid_cells (rn, lat, lon, fetched, src_pos) values
  ${rows};
`;
}

if (process.argv[1] && process.argv[1].endsWith("land_grid.mjs")) {
  const argv = process.argv.slice(2);
  if (argv.includes("--fetch")) {
    const n = await fetchLand();
    console.error(`陸地データを保存しました(${n} リング)`);
  }
  const { points, keep, rings } = await build();
  if (argv.includes("--sql")) {
    process.stdout.write(toSql(points, keep));
  } else if (argv.includes("--mask")) {
    process.stdout.write(toMask(points) + "\n");
  } else if (argv.includes("--write-mask")) {
    await mkdir(path.dirname(MASK_FILE), { recursive: true });
    await writeFile(MASK_FILE, toMask(points) + "\n");
    console.log(`書き出しました: ${MASK_FILE}`);
  } else {
    const pct = Math.round((keep.length / points.length) * 100);
    console.log(`海岸線のリング  : ${rings.length}`);
    console.log(`格子の地点     : ${points.length}`);
    console.log(`取りに行く地点  : ${keep.length} (${pct}%)`);
    console.log(`落とす地点     : ${points.length - keep.length}`);
    const check = (lat, lon, want, name) => {
      const p = points.find((q) => q.lat === lat && q.lon === lon);
      const ok = p && p.fetched === want;
      console.log(`  ${ok ? "ok  " : "FAIL"} ${name} (${lat},${lon}) → ${p.fetched ? "取得" : "省略"}`);
      return ok;
    };
    let allOk = true;
    allOk &= check(36, 138, true, "本州中央");
    allOk &= check(43, 142, true, "北海道");
    allOk &= check(33, 131, true, "九州");
    allOk &= check(24, 124, true, "石垣島");
    allOk &= check(27, 142, true, "小笠原");
    allOk &= check(38, 139, true, "日本海側");
    allOk &= check(27, 140, true, "小笠原の西(補間に要る)");
    allOk &= check(31, 136, false, "太平洋の沖");
    allOk &= check(38, 145, false, "三陸の遥か沖");
    allOk &= check(45, 132, true, "沿海州(大陸側の陸)");
    console.log(allOk ? "\n代表地点の判定はすべて期待どおり" : "\n判定が期待と違う地点がある");

    const v = verifyLandUnaffected(points, rings);
    if (v.badCount === 0) {
      console.log(
        `陸の値は不変 : 海岸線 ${v.segments} 線分が横切る ${v.cells} マスすべてで、4隅が残っている`
      );
    } else {
      console.log(`陸の値が変わる: ${v.badCount} 箇所`);
      v.bad.forEach((b) => console.log("   " + b));
    }
  }
}
