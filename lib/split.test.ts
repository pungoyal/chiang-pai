import { describe, expect, it } from "vitest";
import {
  type BillEntryInput,
  type BillForNets,
  billTotalC,
  buildEntries,
  CURRENCIES,
  equalShares,
  fmtMoney,
  isCurrency,
  memberBillLine,
  memberNets,
  nets,
  parseAmount,
  SplitError,
  settleUpPlan,
} from "./split.ts";

const paid = (memberId: string, paidC: number, participant = true): BillEntryInput => ({
  memberId,
  paidC,
  participant,
});

describe("equalShares", () => {
  it("splits evenly when the total divides", () => {
    expect([...equalShares(3000, ["a", "b", "c"])]).toEqual([
      ["a", 1000],
      ["b", 1000],
      ["c", 1000],
    ]);
  });

  it("lands remainder cents on the first ids, summing exactly", () => {
    const shares = equalShares(1000, ["c", "a", "b"]);
    expect([...shares]).toEqual([
      ["a", 334],
      ["b", 333],
      ["c", 333],
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const one = equalShares(101, ["z", "m", "a"]);
    const two = equalShares(101, ["a", "z", "m"]);
    expect([...one].sort()).toEqual([...two].sort());
  });

  it("always sums to the total (fuzz)", () => {
    for (let round = 0; round < 200; round++) {
      const n = 1 + Math.floor(Math.random() * 8);
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      const totalC = Math.floor(Math.random() * 1_000_000);
      const shares = equalShares(totalC, ids);
      const sum = [...shares.values()].reduce((s, c) => s + c, 0);
      expect(sum).toBe(totalC);
      const values = [...shares.values()];
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
  });

  it("rejects an empty split", () => {
    expect(() => equalShares(100, [])).toThrow(SplitError);
  });
});

describe("buildEntries", () => {
  it("splits equally among participants, payers included by default", () => {
    const entries = buildEntries("equal", [paid("a", 3000), paid("b", 0), paid("c", 0)]);
    expect(entries).toEqual([
      { memberId: "a", paidC: 3000, owedC: 1000, participant: true },
      { memberId: "b", paidC: 0, owedC: 1000, participant: true },
      { memberId: "c", paidC: 0, owedC: 1000, participant: true },
    ]);
  });

  it("keeps a payer who isn't in the split, with zero owed", () => {
    const entries = buildEntries("equal", [paid("a", 2000, false), paid("b", 0), paid("c", 0)]);
    expect(entries).toEqual([
      { memberId: "a", paidC: 2000, owedC: 0, participant: false },
      { memberId: "b", paidC: 0, owedC: 1000, participant: true },
      { memberId: "c", paidC: 0, owedC: 1000, participant: true },
    ]);
  });

  it("drops members who neither paid nor participate", () => {
    const entries = buildEntries("equal", [paid("a", 500), paid("b", 0, false)]);
    expect(entries).toEqual([{ memberId: "a", paidC: 500, owedC: 500, participant: true }]);
  });

  it("takes exact shares in custom mode when they sum to the total", () => {
    const entries = buildEntries("custom", [
      { memberId: "a", paidC: 1000, participant: true, owedC: 250 },
      { memberId: "b", paidC: 0, participant: true, owedC: 750 },
    ]);
    expect(entries.map((e) => e.owedC)).toEqual([250, 750]);
  });

  it("rejects custom shares that don't add up", () => {
    expect(() =>
      buildEntries("custom", [
        { memberId: "a", paidC: 1000, participant: true, owedC: 300 },
        { memberId: "b", paidC: 0, participant: true, owedC: 600 },
      ]),
    ).toThrow(SplitError);
  });

  it("owed always matches paid, whatever the mode (fuzz)", () => {
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(Math.random() * 6);
      const inputs: BillEntryInput[] = Array.from({ length: n }, (_, i) => ({
        memberId: `m${i}`,
        paidC: Math.floor(Math.random() * 10_000),
        participant: Math.random() > 0.3,
      }));
      if (!inputs.some((i) => i.paidC > 0)) inputs[0].paidC = 100;
      if (!inputs.some((i) => i.participant)) inputs[0].participant = true;
      const entries = buildEntries("equal", inputs);
      const paidSum = entries.reduce((s, e) => s + e.paidC, 0);
      const owedSum = entries.reduce((s, e) => s + e.owedC, 0);
      expect(owedSum).toBe(paidSum);
      expect(paidSum).toBe(billTotalC(inputs));
    }
  });

  it("rejects nothing paid, nobody in the split, duplicates, and negatives", () => {
    expect(() => buildEntries("equal", [paid("a", 0)])).toThrow(SplitError);
    expect(() => buildEntries("equal", [paid("a", 100, false)])).toThrow(SplitError);
    expect(() => buildEntries("equal", [paid("a", 100), paid("a", 200)])).toThrow(SplitError);
    expect(() => buildEntries("equal", [paid("a", -100), paid("b", 200)])).toThrow(SplitError);
    expect(() =>
      buildEntries("custom", [{ memberId: "a", paidC: 100, participant: true, owedC: -100 }]),
    ).toThrow(SplitError);
  });
});

describe("nets", () => {
  it("nets paid minus owed per member, per currency, never mixing them", () => {
    const bills: BillForNets[] = [
      {
        currency: "inr",
        entries: [
          { memberId: "a", paidC: 3000, owedC: 1000 },
          { memberId: "b", paidC: 0, owedC: 1000 },
          { memberId: "c", paidC: 0, owedC: 1000 },
        ],
      },
      {
        currency: "thb",
        entries: [
          { memberId: "b", paidC: 900, owedC: 450 },
          { memberId: "a", paidC: 0, owedC: 450 },
        ],
      },
    ];
    const byCurrency = nets(bills);
    expect([...byCurrency.get("inr")!]).toEqual([
      ["a", 2000],
      ["b", -1000],
      ["c", -1000],
    ]);
    expect([...byCurrency.get("thb")!]).toEqual([
      ["b", 450],
      ["a", -450],
    ]);
  });

  it("a settlement bill zeroes the pair out", () => {
    const dinner: BillForNets = {
      currency: "thb",
      entries: [
        { memberId: "a", paidC: 800, owedC: 400 },
        { memberId: "b", paidC: 0, owedC: 400 },
      ],
    };
    const payback: BillForNets = {
      currency: "thb",
      entries: [
        { memberId: "b", paidC: 400, owedC: 0 },
        { memberId: "a", paidC: 0, owedC: 400 },
      ],
    };
    const net = nets([dinner, payback]).get("thb")!;
    expect(net.get("a")).toBe(0);
    expect(net.get("b")).toBe(0);
  });

  it("nets sum to zero per currency (fuzz)", () => {
    for (let round = 0; round < 100; round++) {
      const bills: BillForNets[] = Array.from(
        { length: 1 + Math.floor(Math.random() * 10) },
        () => {
          const n = 2 + Math.floor(Math.random() * 5);
          const inputs: BillEntryInput[] = Array.from({ length: n }, (_, i) => ({
            memberId: `m${i}`,
            paidC: Math.floor(Math.random() * 5000),
            participant: true,
          }));
          if (!inputs.some((i) => i.paidC > 0)) inputs[0].paidC = 1;
          return {
            currency: Math.random() > 0.5 ? "inr" : "thb",
            entries: buildEntries("equal", inputs),
          };
        },
      );
      for (const net of nets(bills).values()) {
        expect([...net.values()].reduce((s, c) => s + c, 0)).toBe(0);
      }
    }
  });
});

describe("memberBillLine", () => {
  const entries = [
    { memberId: "a", paidC: 3000, owedC: 1000 },
    { memberId: "b", paidC: 0, owedC: 2000 },
    { memberId: "c", paidC: 0, owedC: 0 },
  ];

  it("reads a member's paid, owed, and net off a bill", () => {
    expect(memberBillLine(entries, "a")).toEqual({ paidC: 3000, owedC: 1000, netC: 2000 });
    expect(memberBillLine(entries, "b")).toEqual({ paidC: 0, owedC: 2000, netC: -2000 });
  });

  it("returns null for members the bill doesn't involve", () => {
    expect(memberBillLine(entries, "c")).toBeNull();
    expect(memberBillLine(entries, "nobody")).toBeNull();
  });
});

describe("memberNets", () => {
  const dinner: BillForNets = {
    currency: "inr",
    entries: [
      { memberId: "a", paidC: 3000, owedC: 1500 },
      { memberId: "b", paidC: 0, owedC: 1500 },
    ],
  };
  const cab: BillForNets = {
    currency: "thb",
    entries: [
      { memberId: "b", paidC: 900, owedC: 450 },
      { memberId: "c", paidC: 0, owedC: 450 },
    ],
  };

  it("nets each currency the member's bills touch, in CURRENCIES order", () => {
    expect(memberNets([cab, dinner], "b")).toEqual([
      { currency: "inr", netC: -1500 },
      { currency: "thb", netC: 450 },
    ]);
  });

  it("skips currencies the member was never part of", () => {
    expect(memberNets([dinner, cab], "a")).toEqual([{ currency: "inr", netC: 1500 }]);
    expect(memberNets([dinner], "nobody")).toEqual([]);
  });

  it("keeps a settled currency at zero rather than dropping it", () => {
    const payback: BillForNets = {
      currency: "inr",
      entries: [
        { memberId: "b", paidC: 1500, owedC: 0 },
        { memberId: "a", paidC: 0, owedC: 1500 },
      ],
    };
    expect(memberNets([dinner, payback], "b")).toEqual([{ currency: "inr", netC: 0 }]);
  });
});

describe("settleUpPlan", () => {
  it("clears every net with at most n−1 transfers", () => {
    const net = new Map([
      ["a", 2000],
      ["b", -1000],
      ["c", -1000],
    ]);
    expect(settleUpPlan(net)).toEqual([
      { fromId: "b", toId: "a", amountC: 1000 },
      { fromId: "c", toId: "a", amountC: 1000 },
    ]);
  });

  it("returns nothing when everyone is square", () => {
    expect(settleUpPlan(new Map([["a", 0]]))).toEqual([]);
    expect(settleUpPlan(new Map())).toEqual([]);
  });

  it("executing the plan zeroes the nets, with fewer transfers than people (fuzz)", () => {
    for (let round = 0; round < 200; round++) {
      const n = 2 + Math.floor(Math.random() * 7);
      const net = new Map<string, number>();
      let sum = 0;
      for (let i = 0; i < n - 1; i++) {
        const c = Math.floor(Math.random() * 20_000) - 10_000;
        net.set(`m${i}`, c);
        sum += c;
      }
      // Not -sum: when sum is 0 that's -0, which Object.is-based toBe(0) rejects.
      net.set(`m${n - 1}`, sum === 0 ? 0 : -sum);

      const plan = settleUpPlan(net);
      expect(plan.length).toBeLessThanOrEqual(Math.max(0, n - 1));
      const after = new Map(net);
      for (const t of plan) {
        expect(t.amountC).toBeGreaterThan(0);
        after.set(t.fromId, (after.get(t.fromId) ?? 0) + t.amountC);
        after.set(t.toId, (after.get(t.toId) ?? 0) - t.amountC);
      }
      for (const c of after.values()) expect(c).toBe(0);
    }
  });
});

describe("fmtMoney", () => {
  it("formats whole amounts without decimals", () => {
    expect(fmtMoney("thb", 64000)).toBe("฿640");
    expect(fmtMoney("inr", 120000)).toBe("₹1,200");
  });

  it("uses Indian digit grouping for rupees only", () => {
    expect(fmtMoney("inr", 12345600)).toBe("₹1,23,456");
    expect(fmtMoney("thb", 12345600)).toBe("฿123,456");
  });

  it("shows paise and satang only when present, and signs on request", () => {
    expect(fmtMoney("inr", 123450)).toBe("₹1,234.50");
    expect(fmtMoney("thb", 105)).toBe("฿1.05");
    expect(fmtMoney("inr", 500, { sign: true })).toBe("+₹5");
    expect(fmtMoney("inr", -500)).toBe("−₹5");
    expect(fmtMoney("inr", 0, { sign: true })).toBe("₹0");
  });
});

describe("parseAmount", () => {
  it("reads plain and decimal amounts into centi-units", () => {
    expect(parseAmount("640")).toBe(64000);
    expect(parseAmount("1234.5")).toBe(123450);
    expect(parseAmount("1,234.50")).toBe(123450);
    expect(parseAmount(" 12 ")).toBe(1200);
    expect(parseAmount("0.05")).toBe(5);
  });

  it("rejects anything that isn't money", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
    expect(parseAmount("12.")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1e3")).toBeNull();
  });
});

describe("money without minor units", () => {
  it("formats đồng and rupiah whole, with symbols and grouping", () => {
    expect(fmtMoney("vnd", 25_000_000)).toBe("₫250,000");
    expect(fmtMoney("idr", 1_500_050)).toBe("Rp15,001");
    expect(fmtMoney("jpy", -120_000, { sign: true })).toBe("−¥1,200");
    expect(fmtMoney("aed", 12_345)).toBe("AED 123.45");
    expect(fmtMoney("inr", 123_456_700)).toBe("₹12,34,567");
  });
  it("knows every currency a destination can spend", () => {
    expect(isCurrency("thb")).toBe(true);
    expect(isCurrency("btc")).toBe(false);
    expect(CURRENCIES.length).toBeGreaterThan(10);
  });
});
