#!/usr/bin/env python3
"""
Збирає lib/categoryTree.json з Excel-файлу дерева категорій (skay_categories_UA_RU.xlsx).

Запуск:  python3 scripts/build-category-tree.py skay_categories_UA_RU.xlsx
Потрібно: pip install openpyxl

Дерево береться з аркуша «Таблиця (фільтр)». Лічильники з Excel НЕ використовуються —
кількість товарів у кнопках бот рахує вживу з поточного фіда (тільки товари в наявності).
"""
import json
import sys
from pathlib import Path

import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else "skay_categories_UA_RU.xlsx"
OUT = Path(__file__).resolve().parent.parent / "lib" / "categoryTree.json"

OTHER_PREFIX = "Інші категорії"

# «Інші категорії з фіду» — групи, яких немає в меню сайту. Очевидні групи переносимо до
# відповідних розділів меню, щоб, напр., «Одяг для тварин» був у «Товари для тварин».
MERGE_GROUPS = {
    "Тварини та акваріуми": "Товари для тварин",
    "Для блогерів": "Фото та відео",
    "Спорт, туризм та активний відпочинок": "Спорт та розваги",
    "Кухня, дім та побут": "Побутова техніка",
    "Інструменти": "Товари для дому та авто",
}
# Якщо в розділі вже є підкатегорія з іншою назвою, але тієї ж теми — діти групи вкладаємо в неї.
HOST_SUBCATEGORY = {"Для блогерів": "Товари для блогерів"}
PROMOTE_GROUPS = {"Телевізори"}            # окремий видимий розділ
SKIP_SECTIONS = {"Послуги", "Знижки та акції"}   # не товарні розділи
SKIP_GROUPS = {"Інше та службові"}

# Додаткові слова-синоніми. Ключ — назва вузла (UA). Потрібні там, де людина називає
# предмет, а не назву категорії («собака», «нашийник», «миска»).
ALIASES = {
    "Товари для тварин": [
        "тварина", "тварини", "тваринка", "собака", "собаки", "собаку", "пес", "песик", "цуцик", "цуценя",
        "кіт", "кота", "коти", "кішка", "кішки", "котик", "кошеня", "хом'як", "хомяк", "папуга", "рибки",
        "гризун", "pet", "pets", "животное", "животные", "кошка", "кошки", "щенок", "котенок", "попугай",
        "питомець", "улюбленець", "домашній улюбленець",
    ],
    "Товари для дітей": [
        "дитина", "дитини", "діти", "дитячий", "дитяча", "дитячі", "малюк", "малюка", "немовля",
        "ребенок", "дети", "детский", "детская", "малыш",
    ],
    "Іграшки та амуніція": [
        "нашийник", "повідець", "поводок", "ошейник", "шлейка", "амуніція", "намордник", "лежак", "лежанка",
    ],
    "Годівниці та поїлки": ["миска", "миски", "мисочка", "поїлка", "годівниця", "миска-годівниця", "кормушка", "поилка"],
    "Корм, ласощі": ["корм", "ласощі", "смаколики", "лакомства", "вітаміни для тварин"],
    "Догляд та гігієна": ["лоток", "наповнювач", "пелюшки", "гігієнічні пакети", "пакети для вигулу", "когтерізка", "кігтерізка"],
    "Аксесуари для тварин": ["переноска", "ліжко для тварин", "будиночок", "когтеточка", "дряпка", "лежак", "лоток"],
    "Зовнішні акумулятори, Power Bank": ["павербанк", "повербанк", "powerbank", "power bank", "пауэрбанк", "повер"],
}


def clean(s):
    return None if s is None else str(s).strip()


wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb["Таблиця (фільтр)"]
rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[0]]

nodes = []          # плоский список у порядку меню
by_key = {}


def add(ua, ru, cid, parent, depth, section, **flags):
    key = f"n{len(nodes) + 1}"
    node = {"k": key, "id": cid, "ua": ua, "ru": ru or ua, "p": parent, "d": depth, "sec": section}
    node.update({k: v for k, v in flags.items() if v})
    nodes.append(node)
    by_key[key] = node
    return node


sections = {}       # ua -> node
cur_section = None
cur_sub1 = None
groups = []         # (group_node_key, group_ua) для «Інших»
in_other = False

for r in rows:
    sec_ua, sec_ru, s1_ua, s1_ru, s2_ua, s2_ru, cid, _cnt = r[:8]
    sec_ua, sec_ru, s1_ua, s1_ru, s2_ua, s2_ru = map(clean, (sec_ua, sec_ru, s1_ua, s1_ru, s2_ua, s2_ru))
    in_other = sec_ua.startswith(OTHER_PREFIX)
    if in_other:
        if cur_section is None or cur_section["ua"] != sec_ua:
            cur_section = add(sec_ua, sec_ru, None, None, 0, sec_ua, hid=True)
            sections[sec_ua] = cur_section
        if s1_ua and not s2_ua:
            cur_sub1 = add(s1_ua, s1_ru, cid, cur_section["k"], 1, sec_ua, hid=True,
                           skip=(s1_ua in SKIP_GROUPS))
            groups.append(cur_sub1)
        elif s2_ua and cur_sub1 is not None:
            add(s2_ua, s2_ru, cid, cur_sub1["k"], 2, sec_ua, hid=True, skip=cur_sub1.get("skip"))
        continue

    if s1_ua is None:
        cur_section = add(sec_ua, sec_ru, cid, None, 0, sec_ua, skip=(sec_ua in SKIP_SECTIONS))
        sections[sec_ua] = cur_section
        cur_sub1 = None
    elif s2_ua is None:
        cur_sub1 = add(s1_ua, s1_ru, cid, cur_section["k"], 1, sec_ua, skip=cur_section.get("skip"))
    else:
        add(s2_ua, s2_ru, cid, cur_sub1["k"], 2, sec_ua, skip=cur_section.get("skip"))

# ── Перенесення очевидних груп «Інших» у розділи меню ──────────────────────────
def children_of(key):
    return [n for n in nodes if n["p"] == key]


def reparent(node, new_parent, new_depth):
    node["p"] = new_parent["k"] if new_parent else None
    node["d"] = new_depth
    node["sec"] = (new_parent or node)["sec"] if new_parent else node["ua"]
    node.pop("hid", None)
    for ch in children_of(node["k"]):
        reparent(ch, node, new_depth + 1)


for g in list(groups):
    gname = g["ua"]
    if gname in PROMOTE_GROUPS:
        for n in [g] + children_of(g["k"]):
            n.pop("hid", None)
        g["p"] = None
        g["d"] = 0
        g["sec"] = gname
        for ch in children_of(g["k"]):
            ch["d"] = 1
            ch["sec"] = gname
        continue
    target_name = MERGE_GROUPS.get(gname)
    if not target_name:
        continue
    target = sections[target_name]
    # якщо в розділі вже є підкатегорія з такою ж назвою, що й група — вкладаємо діти туди
    same = [c for c in children_of(target["k"]) if c["ua"] in (gname, HOST_SUBCATEGORY.get(gname))]
    host = same[0] if same else target
    host_depth = 1 if same else 0
    for ch in children_of(g["k"]):
        if ch["ua"] == target["ua"] and ch["id"] is not None:
            # «Товари для тварин» (529) = той самий розділ → додаткова категорія розділу
            target.setdefault("xids", []).append(ch["id"])
            nodes.remove(ch)
            by_key.pop(ch["k"], None)
            continue
        reparent(ch, host, host_depth + 1)
    nodes.remove(g)
    by_key.pop(g["k"], None)

# ── Вкладеність, яка є на сайті, але не в Excel ────────────────────────────────
# «Кухонне приладдя» (993) на сайті лежить усередині «Посуд» (992): разом 77 товарів, а не 20 + 57 окремо.
NEST = {993: 992}
# Як назвати кнопку з товарами, що лежать безпосередньо в розділі (замість безликого «Інше»).
DIRECT_LABELS = {992: "Сковорідки, гусятниці, контейнери"}
by_id = {n["id"]: n for n in nodes if n.get("id") is not None}
for child_id, parent_id in NEST.items():
    child, parent = by_id.get(child_id), by_id.get(parent_id)
    if child and parent and child["p"] != parent["k"]:
        child["p"] = parent["k"]
        child["d"] = parent["d"] + 1
for cid, label in DIRECT_LABELS.items():
    if cid in by_id:
        by_id[cid]["dl"] = label

# ── Синоніми ───────────────────────────────────────────────────────────────────
for n in nodes:
    al = ALIASES.get(n["ua"])
    if al:
        n["al"] = al

# ── Порядок: розділи меню по порядку, діти слідом (DFS) ─────────────────────────
kids = {}
for n in nodes:
    kids.setdefault(n["p"], []).append(n)
ordered = []


def dfs(n):
    ordered.append(n)
    for ch in kids.get(n["k"], []):
        dfs(ch)


for top in kids.get(None, []):
    dfs(top)

# глибина/розділ — перерахунок після перенесень
def fix(n, depth, sec):
    n["d"] = depth
    n["sec"] = sec
    for ch in kids.get(n["k"], []):
        fix(ch, depth + 1, sec)


for top in kids.get(None, []):
    fix(top, 0, top["ua"])

OUT.write_text(json.dumps({"version": 1, "nodes": ordered}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"OK: {len(ordered)} вузлів → {OUT}")