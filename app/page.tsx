"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  isAddress,
  formatUnits,
  parseUnits,
  type Address,
  type Hash
} from "viem";
import { celoSepolia } from "viem/chains";

type Screen = "welcome" | "dashboard" | "mine" | "manager" | "log";
type Resource = "gold" | "emeralds" | "diamonds";
type AiActionResult = "mined" | "wait";
type ManagerPlanId = "trial" | "basic" | "premium";
type InfrastructureId = "cabin" | "storage" | "workshop" | "control";
type MiniPayPaymentStatus =
  | "idle"
  | "connecting"
  | "awaiting-signature"
  | "confirming"
  | "confirmed"
  | "failed";
type IconName =
  | "pickaxe"
  | "bolt"
  | "gem"
  | "brain"
  | "scroll"
  | "lock"
  | "clock"
  | "arrow"
  | "home"
  | "sparkles"
  | "check"
  | "shield";

type DecisionLog = {
  id: string;
  time: string;
  energy: number;
  decision: string;
  reason: string;
  confidence: number | null;
  result: string;
  tone: "gold" | "emerald" | "diamond" | "wait";
};

type ManagerPlan = {
  id: ManagerPlanId;
  name: string;
  duration: number;
  label: string;
  locked: boolean;
  accent: string;
  priceUsdc?: string;
};

type GameState = {
  gold: number;
  emeralds: number;
  diamonds: number;
  mineCoins: number;
  builtUpgrades: InfrastructureId[];
  energy: number;
  mineLevel: number;
  miniPayUnlocked: boolean;
  miniPayPurchasedPlans: ManagerPlanId[];
  miniPayLastPurchasedPlan: ManagerPlanId | null;
  miniPayWalletAddress: string | null;
  miniPayTxHash: string | null;
  miniPayUnlockedAt: number | null;
  miniPayPaymentStatus: MiniPayPaymentStatus;
  miniPayError: string | null;
  miniPayTokenAddress: string | null;
  miniPayRequiredAmount: string | null;
  miniPayDetectedBalance: string | null;
  miniPayChainId: string | null;
  currentPaidManagerPlan: ManagerPlanId | null;
  currentPaidManagerExpiresAt: number | null;
  managerPlan: ManagerPlan["id"] | null;
  managerActivatedAt: number | null;
  managerExpiresAt: number | null;
  nextAiRunAt: number | null;
  lastAiActionAt: number | null;
  lastAiActionResult: AiActionResult | null;
  nextEnergyAt: number;
  logs: DecisionLog[];
};

const MAX_ENERGY = 100;
const AI_DECISION_INTERVAL_MS = 8_000;
const ENERGY_REGEN_INTERVAL_MS = 5_000;
const STORAGE_KEY = "mineai-game-v1";
const RESOURCE_TO_MINECOINS: Record<Resource, number> = {
  gold: 1,
  emeralds: 5,
  diamonds: 20
};
const MINI_PAY_TREASURY_ADDRESS = process.env.NEXT_PUBLIC_MINEAI_MINIPAY_TREASURY_ADDRESS;
const MINI_PAY_STABLE_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_MINEAI_MINIPAY_STABLE_TOKEN_ADDRESS;
const MINI_PAY_STABLE_TOKEN_DECIMALS = Number(
  process.env.NEXT_PUBLIC_MINEAI_MINIPAY_STABLE_TOKEN_DECIMALS ?? "6"
);
const MINI_PAY_UNLOCK_AMOUNT = process.env.NEXT_PUBLIC_MINEAI_MINIPAY_UNLOCK_AMOUNT ?? "0.000001";
const MINI_PAY_EXPLORER_BASE =
  process.env.NEXT_PUBLIC_MINEAI_MINIPAY_EXPLORER_BASE_URL ??
  "https://celo-sepolia.blockscout.com/tx/";
const ENABLE_SIMULATED_MINIPAY_FALLBACK =
  process.env.NEXT_PUBLIC_MINEAI_ENABLE_SIMULATED_MINIPAY === "true";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  }
] as const;

function createInitialGame(): GameState {
  return {
    gold: 0,
    emeralds: 0,
    diamonds: 0,
    mineCoins: 0,
    builtUpgrades: [],
    energy: 100,
    mineLevel: 1,
    miniPayUnlocked: false,
    miniPayPurchasedPlans: [],
    miniPayLastPurchasedPlan: null,
    miniPayWalletAddress: null,
    miniPayTxHash: null,
    miniPayUnlockedAt: null,
    miniPayPaymentStatus: "idle",
    miniPayError: null,
    miniPayTokenAddress: null,
    miniPayRequiredAmount: null,
    miniPayDetectedBalance: null,
    miniPayChainId: null,
    currentPaidManagerPlan: null,
    currentPaidManagerExpiresAt: null,
    managerPlan: null,
    managerActivatedAt: null,
    managerExpiresAt: null,
    nextAiRunAt: null,
    lastAiActionAt: null,
    lastAiActionResult: null,
    nextEnergyAt: Date.now() + ENERGY_REGEN_INTERVAL_MS,
    logs: []
  };
}

const plans: ManagerPlan[] = [
  {
    id: "trial",
    name: "Free Trial Manager",
    duration: 1,
    label: "1 hour",
    locked: false,
    accent: "from-[#253348] to-[#17202c]"
  },
  {
    id: "basic",
    name: "Basic AI Manager",
    duration: 4,
    label: "4 hours",
    locked: true,
    accent: "from-[#123d32] to-[#12231f]",
    priceUsdc: "0.000001"
  },
  {
    id: "premium",
    name: "Premium AI Manager",
    duration: 6,
    label: "6 hours",
    locked: true,
    accent: "from-[#4a3513] to-[#251d11]",
    priceUsdc: "0.000003"
  }
];

const infrastructureUpgrades: Array<{
  id: InfrastructureId;
  name: string;
  cost: number;
  description: string;
}> = [
  {
    id: "cabin",
    name: "Wooden Cabin",
    cost: 25,
    description: "A first base for your mining crew."
  },
  {
    id: "storage",
    name: "Storage House",
    cost: 75,
    description: "A safer place to hold extracted resources."
  },
  {
    id: "workshop",
    name: "Mining Workshop",
    cost: 150,
    description: "Tools and benches for deeper mining work."
  },
  {
    id: "control",
    name: "AI Control Center",
    cost: 300,
    description: "A command room for automated mine operations."
  }
];

declare global {
  interface Window {
    ethereum?: {
      isMiniPay?: boolean;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

function Icon({
  name,
  className = "h-5 w-5"
}: {
  name: IconName;
  className?: string;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  const paths: Record<IconName, React.ReactNode> = {
    pickaxe: (
      <>
        <path {...common} d="M14.5 5.5 19 10M11 9l8-5M12.5 10.5 5 18" />
        <path {...common} d="m4 16 4 4M8 6c2.7-2.5 6.8-2.5 10 0" />
      </>
    ),
    bolt: <path {...common} d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />,
    gem: (
      <>
        <path {...common} d="m6 4-4 6 10 11 10-11-4-6H6Z" />
        <path {...common} d="m2 10 10 11 10-11M6 4l6 17 6-17M2 10h20" />
      </>
    ),
    brain: (
      <>
        <path {...common} d="M9.5 4.5A3 3 0 0 0 4 6v1.2A3 3 0 0 0 3 12a3 3 0 0 0 2 4.8V18a3 3 0 0 0 5.5 1.7V4.5Z" />
        <path {...common} d="M14.5 4.5A3 3 0 0 1 20 6v1.2a3 3 0 0 1 1 4.8 3 3 0 0 1-2 4.8V18a3 3 0 0 1-5.5 1.7V4.5ZM8 9a2 2 0 0 1-2-2M16 9a2 2 0 0 0 2-2M8 15a2 2 0 0 0 2-2M16 15a2 2 0 0 1-2-2" />
      </>
    ),
    scroll: (
      <>
        <path {...common} d="M6 3h12v15a3 3 0 0 1-3 3H6a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3Z" />
        <path {...common} d="M6 3a3 3 0 0 0-3 3h6M12 9h3M12 13h3" />
      </>
    ),
    lock: (
      <>
        <rect {...common} x="4" y="10" width="16" height="11" rx="2" />
        <path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    clock: (
      <>
        <circle {...common} cx="12" cy="12" r="9" />
        <path {...common} d="M12 7v5l3 2" />
      </>
    ),
    arrow: <path {...common} d="m9 18 6-6-6-6" />,
    home: (
      <>
        <path {...common} d="m3 11 9-8 9 8" />
        <path {...common} d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    sparkles: (
      <>
        <path {...common} d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
        <path {...common} d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 13l.7 1.8 1.8.7-1.8.7L19 18l-.7-1.8-1.8-.7 1.8-.7L19 13Z" />
      </>
    ),
    check: <path {...common} d="m5 12 4 4L19 6" />,
    shield: (
      <>
        <path {...common} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path {...common} d="m9 12 2 2 4-4" />
      </>
    )
  };

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, "0")}`
    : `0:${seconds.toString().padStart(2, "0")}`;
}

function shorten(value: string | null, edge = 6) {
  if (!value) return "Not connected";
  return `${value.slice(0, edge)}...${value.slice(-4)}`;
}

function getMiniPayExplorerUrl(hash: string | null) {
  return hash ? `${MINI_PAY_EXPLORER_BASE}${hash}` : null;
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createLog(
  energy: number,
  decision: string,
  reason: string,
  confidence: number | null,
  result: string,
  tone: DecisionLog["tone"]
): DecisionLog {
  return {
    id: `${Date.now()}-${Math.random()}`,
    time: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    }),
    energy,
    decision,
    reason,
    confidence,
    result,
    tone
  };
}

function resolveAiAction(game: GameState): GameState {
  const energyBefore = game.energy;
  let resource: Resource | null = null;
  let cost = 0;
  let amount = 0;
  let reason = "";
  let confidence = 0;
  let tone: DecisionLog["tone"] = "wait";

  if (game.energy >= 20 && Math.random() < 0.36) {
    resource = "diamonds";
    cost = 20;
    amount = randomBetween(0, 1);
    reason = "High energy reserves made a rare-resource attempt strategically affordable.";
    confidence = Math.min(86, 74 + Math.floor((game.energy - 20) / 10) * 2);
    tone = "diamond";
  } else if (game.energy >= 10) {
    resource = "emeralds";
    cost = 10;
    amount = randomBetween(1, 3);
    reason = "Best energy efficiency for the current reserve level.";
    confidence = Math.min(96, 88 + Math.floor((game.energy - 10) / 15) * 2);
    tone = "emerald";
  } else if (game.energy >= 5) {
    resource = "gold";
    cost = 5;
    amount = randomBetween(3, 5);
    reason = "Safest return while preserving limited energy.";
    confidence = Math.min(94, 86 + (game.energy - 5));
    tone = "gold";
  }

  if (!resource) {
    const waitLog = createLog(
      energyBefore,
      "Wait and recharge",
      "Energy was below the minimum needed for a mining run.",
      99,
      "No resources mined",
      "wait"
    );
    return {
      ...game,
      lastAiActionAt: Date.now(),
      lastAiActionResult: "wait",
      logs: [waitLog, ...game.logs].slice(0, 30)
    };
  }

  const labels: Record<Resource, string> = {
    gold: "Gold",
    emeralds: "Emeralds",
    diamonds: "Diamonds"
  };
  const actionLog = createLog(
    energyBefore,
    `Mine ${labels[resource]}`,
    reason,
    confidence,
    `+${amount} ${labels[resource]}`,
    tone
  );

  return {
    ...game,
    energy: game.energy - cost,
    [resource]: game[resource] + amount,
    lastAiActionAt: Date.now(),
    lastAiActionResult: "mined",
    logs: [actionLog, ...game.logs].slice(0, 30)
  };
}

function MineIllustration() {
  return (
    <div className="relative mx-auto h-52 w-64 mine-glow">
      <div className="pulse-ring absolute left-1/2 top-[44%] h-28 w-28 -translate-x-1/2 rounded-full border border-gold/25" />
      <svg viewBox="0 0 300 230" className="relative h-full w-full">
        <defs>
          <linearGradient id="rock" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#39414a" />
            <stop offset="100%" stopColor="#171c22" />
          </linearGradient>
          <linearGradient id="track" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a86e2e" />
            <stop offset="100%" stopColor="#4f3219" />
          </linearGradient>
        </defs>
        <path d="M23 197 58 87 105 42l51-20 54 26 46 61 24 88Z" fill="url(#rock)" />
        <path d="M73 198V113l29-46 49-23 48 23 29 46v85Z" fill="#242a31" />
        <path d="M103 198v-70c0-37 21-62 48-62s48 25 48 62v70Z" fill="#06080b" />
        <path d="M111 198v-66c0-31 17-53 40-53s40 22 40 53v66Z" fill="#101419" />
        <path d="M151 80v118M106 122h90M102 150h98" stroke="#5c4126" strokeWidth="7" />
        <path d="M127 205 145 100M175 205l-18-105" stroke="url(#track)" strokeWidth="8" />
        <path d="M122 125h57M118 153h66M113 183h76" stroke="#996736" strokeWidth="6" />
        <circle cx="76" cy="148" r="6" fill="#ffc44d" />
        <circle cx="225" cy="136" r="5" fill="#37e59b" />
        <path d="m237 79 8 13-8 13-8-13Z" fill="#77dcff" />
        <path d="m49 177 9 15-9 15-9-15Z" fill="#ffc44d" />
      </svg>
    </div>
  );
}

function TopBar({
  title,
  subtitle,
  onBack,
  action
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between px-5 pb-4 pt-5">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/80 transition hover:bg-white/10"
            aria-label="Go back"
          >
            <Icon name="arrow" className="h-5 w-5 rotate-180" />
          </button>
        )}
        <div>
          <h1 className="text-xl font-black tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs text-white/45">{subtitle}</p>}
        </div>
      </div>
      {action}
    </header>
  );
}

function ResourceCard({
  label,
  value,
  tone,
  symbol
}: {
  label: string;
  value: number;
  tone: "gold" | "emerald" | "diamond";
  symbol: string;
}) {
  const styles = {
    gold: "border-gold/20 bg-gold/[0.06] text-gold",
    emerald: "border-emerald/20 bg-emerald/[0.06] text-emerald",
    diamond: "border-diamond/20 bg-diamond/[0.06] text-diamond"
  };
  return (
    <div className={`rounded-2xl border p-3.5 ${styles[tone]}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">{symbol}</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
          {label}
        </span>
      </div>
      <p className="text-2xl font-black text-white">{value.toLocaleString()}</p>
    </div>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isMiniPayDetected, setIsMiniPayDetected] = useState(false);

  useEffect(() => {
    setIsMiniPayDetected(Boolean(window.ethereum?.isMiniPay));
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as GameState;
        const current = Date.now();
        const storedPlan = plans.find((plan) => plan.id === parsed.managerPlan);
        const legacyPaidSession =
          parsed.managerPlan && storedPlan?.locked && parsed.managerExpiresAt
            ? parsed.managerExpiresAt
            : null;
        const paidPlan = parsed.currentPaidManagerPlan ?? (legacyPaidSession ? parsed.managerPlan : null);
        const paidExpiresAt = parsed.currentPaidManagerExpiresAt ?? legacyPaidSession;
        const hasActivePaidAccess = Boolean(
          paidPlan &&
            paidExpiresAt &&
            paidExpiresAt > current &&
            paidPlan === parsed.managerPlan
        );
        const hasActiveStoredManager = Boolean(
          parsed.managerPlan &&
            parsed.managerExpiresAt &&
            parsed.managerExpiresAt > current &&
            (!storedPlan?.locked || hasActivePaidAccess)
        );
        setGame({
          ...createInitialGame(),
          ...parsed,
          builtUpgrades: parsed.builtUpgrades ?? [],
          miniPayPurchasedPlans: parsed.miniPayPurchasedPlans ?? [],
          currentPaidManagerPlan: paidPlan,
          currentPaidManagerExpiresAt: paidExpiresAt,
          managerPlan: hasActiveStoredManager ? parsed.managerPlan : null,
          managerActivatedAt: hasActiveStoredManager ? (parsed.managerActivatedAt ?? current) : null,
          managerExpiresAt: hasActiveStoredManager ? parsed.managerExpiresAt : null,
          nextAiRunAt: hasActiveStoredManager
            ? (parsed.nextAiRunAt ?? current + AI_DECISION_INTERVAL_MS)
            : null,
          lastAiActionAt: hasActiveStoredManager ? (parsed.lastAiActionAt ?? null) : null,
          lastAiActionResult: hasActiveStoredManager ? (parsed.lastAiActionResult ?? null) : null,
          nextEnergyAt: parsed.nextEnergyAt || current + ENERGY_REGEN_INTERVAL_MS
        });
        if (hasActiveStoredManager) {
          setNotice("AI Manager session restored");
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
    }
  }, [game, hydrated]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      setGame((previous) => {
        let next = { ...previous };

        if (current >= next.nextEnergyAt) {
          const elapsedTicks = Math.max(
            1,
            Math.floor((current - next.nextEnergyAt) / ENERGY_REGEN_INTERVAL_MS) + 1
          );
          next.energy = Math.min(MAX_ENERGY, next.energy + elapsedTicks * 10);
          next.nextEnergyAt += elapsedTicks * ENERGY_REGEN_INTERVAL_MS;
        }

        if (next.managerExpiresAt && current >= next.managerExpiresAt) {
          const expiredLog = createLog(
            next.energy,
            "Manager shift complete",
            "The selected AI Manager plan reached its time limit.",
            null,
            "Automation paused",
            "wait"
          );
          next = {
            ...next,
            managerPlan: null,
            managerActivatedAt: null,
            managerExpiresAt: null,
            nextAiRunAt: null,
            lastAiActionAt: null,
            lastAiActionResult: null,
            logs: [expiredLog, ...next.logs].slice(0, 30)
          };
        } else if (next.managerPlan && next.nextAiRunAt && current >= next.nextAiRunAt) {
          next = resolveAiAction(next);
          next.nextAiRunAt = current + AI_DECISION_INTERVAL_MS;
        }

        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const managerActive = Boolean(game.managerPlan && game.managerExpiresAt && game.managerExpiresAt > now);
  const activePlan = plans.find((plan) => plan.id === game.managerPlan);
  const hasActivePaidManagerPass = (planId: ManagerPlanId) =>
    Boolean(
      game.currentPaidManagerPlan === planId &&
        game.currentPaidManagerExpiresAt &&
        game.currentPaidManagerExpiresAt > now
    );
  const hasExpiredPaidManagerPass = (planId: ManagerPlanId) =>
    Boolean(
      game.currentPaidManagerPlan === planId &&
        game.currentPaidManagerExpiresAt &&
        game.currentPaidManagerExpiresAt <= now
    );
  const totalResources = game.gold + game.emeralds * 3 + game.diamonds * 10;
  const mineCoinValue =
    game.gold * RESOURCE_TO_MINECOINS.gold +
    game.emeralds * RESOURCE_TO_MINECOINS.emeralds +
    game.diamonds * RESOURCE_TO_MINECOINS.diamonds;
  const productionRate = managerActive ? "2.1 / min" : "Manual";
  const energyCountdown = formatCountdown(game.nextEnergyAt - now);
  const aiCountdown = game.nextAiRunAt ? formatCountdown(game.nextAiRunAt - now) : "0:08";
  const managerExpiresInMinutes =
    managerActive && game.managerExpiresAt
      ? Math.max(1, Math.ceil((game.managerExpiresAt - now) / 60_000))
      : null;
  const managerSessionStatus =
    managerActive && managerExpiresInMinutes
      ? `AI Manager active — expires in ${managerExpiresInMinutes} minute${
          managerExpiresInMinutes === 1 ? "" : "s"
        }`
      : null;
  const aiStatus = !managerActive
    ? "AI offline"
    : game.energy < 5
      ? "Waiting for energy..."
      : game.lastAiActionResult === "mined" &&
          game.lastAiActionAt &&
          now - game.lastAiActionAt < 4_000
        ? "Mining..."
        : "Thinking...";
  const aiStatusTone =
    aiStatus === "Mining..."
      ? "text-gold border-gold/25 bg-gold/10"
      : aiStatus === "Waiting for energy..."
        ? "text-diamond border-diamond/20 bg-diamond/10"
        : "text-emerald border-emerald/25 bg-emerald/10";
  const aiStatusIcon: IconName =
    aiStatus === "Mining..."
      ? "pickaxe"
      : aiStatus === "Waiting for energy..."
        ? "clock"
        : "brain";
  const miniPayExplorerUrl = getMiniPayExplorerUrl(game.miniPayTxHash);
  const miniPayBusy =
    game.miniPayPaymentStatus === "connecting" ||
    game.miniPayPaymentStatus === "awaiting-signature" ||
    game.miniPayPaymentStatus === "confirming";
  const miniPayStatusLabel: Record<MiniPayPaymentStatus, string> = {
    idle: game.miniPayUnlocked ? "Confirmed" : "Not connected",
    connecting: "Connecting wallet",
    "awaiting-signature": "Confirm in MiniPay",
    confirming: "Payment pending",
    confirmed: "Payment confirmed",
    failed: "Payment failed"
  };
  const progress = useMemo(() => Math.min(100, totalResources / 2), [totalResources]);

  const showNotice = (message: string) => setNotice(message);

  const convertResourcesToMineCoins = () => {
    if (mineCoinValue <= 0) {
      showNotice("Mine resources first, then convert them into MineCoins.");
      return;
    }

    setGame((previous) => ({
      ...previous,
      gold: 0,
      emeralds: 0,
      diamonds: 0,
      mineCoins: previous.mineCoins + mineCoinValue
    }));
    showNotice(`Converted resources into ${mineCoinValue} MineCoins.`);
  };

  const buildInfrastructure = (upgrade: (typeof infrastructureUpgrades)[number]) => {
    if (game.builtUpgrades.includes(upgrade.id)) {
      showNotice(`${upgrade.name} is already built.`);
      return;
    }

    if (game.mineCoins < upgrade.cost) {
      showNotice(`You need ${upgrade.cost} MineCoins to build ${upgrade.name}.`);
      return;
    }

    setGame((previous) => ({
      ...previous,
      mineCoins: previous.mineCoins - upgrade.cost,
      builtUpgrades: [...previous.builtUpgrades, upgrade.id],
      mineLevel: Math.max(previous.mineLevel, previous.builtUpgrades.length + 2)
    }));
    showNotice(`${upgrade.name} built! Your mine looks stronger.`);
  };

  const mine = (resource: Resource) => {
    const settings: Record<
      Resource,
      { cost: number; min: number; max: number; label: string; tone: DecisionLog["tone"] }
    > = {
      gold: { cost: 5, min: 3, max: 5, label: "Gold", tone: "gold" },
      emeralds: { cost: 10, min: 1, max: 3, label: "Emeralds", tone: "emerald" },
      diamonds: { cost: 20, min: 0, max: 1, label: "Diamonds", tone: "diamond" }
    };
    const config = settings[resource];
    if (game.energy < config.cost) {
      showNotice(`Not enough energy. You need ${config.cost}.`);
      return;
    }
    const amount = randomBetween(config.min, config.max);
    setGame((previous) => ({
      ...previous,
      energy: previous.energy - config.cost,
      [resource]: previous[resource] + amount
    }));
    showNotice(amount > 0 ? `+${amount} ${config.label} mined!` : "No diamond this time. Keep digging!");
  };

  const unlockWithMiniPay = async (plan: ManagerPlan) => {
    if (miniPayBusy) return;

    try {
      setGame((previous) => ({
        ...previous,
        miniPayPaymentStatus: "connecting",
        miniPayError: null
      }));

      const ethereum = window.ethereum;
      if (!ethereum?.isMiniPay) {
        throw new Error("Open MineAI inside MiniPay to buy AI Managers.");
      }

      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
        params: []
      });
      const currentChainId = await ethereum.request({
        method: "eth_chainId",
        params: []
      });
      const account =
        Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;

      if (!account || !isAddress(account)) {
        throw new Error("MiniPay did not return a valid wallet address.");
      }

      setGame((previous) => ({
        ...previous,
        miniPayWalletAddress: account,
        miniPayChainId: typeof currentChainId === "string" ? currentChainId : null,
        miniPayPaymentStatus: "awaiting-signature",
        miniPayError: null
      }));

      if (!MINI_PAY_TREASURY_ADDRESS || !isAddress(MINI_PAY_TREASURY_ADDRESS)) {
        throw new Error("Configure NEXT_PUBLIC_MINEAI_MINIPAY_TREASURY_ADDRESS.");
      }

      if (!MINI_PAY_STABLE_TOKEN_ADDRESS || !isAddress(MINI_PAY_STABLE_TOKEN_ADDRESS)) {
        throw new Error("Configure NEXT_PUBLIC_MINEAI_MINIPAY_STABLE_TOKEN_ADDRESS.");
      }

      if (!Number.isInteger(MINI_PAY_STABLE_TOKEN_DECIMALS) || MINI_PAY_STABLE_TOKEN_DECIMALS < 0) {
        throw new Error("Configure a valid stable token decimal value.");
      }

      const walletClient = createWalletClient({
        chain: celoSepolia,
        transport: custom(ethereum)
      });
      const publicClient = createPublicClient({
        chain: celoSepolia,
        transport: http()
      });
      const purchaseAmount = plan.priceUsdc ?? MINI_PAY_UNLOCK_AMOUNT;
      const requiredAmount = parseUnits(purchaseAmount, MINI_PAY_STABLE_TOKEN_DECIMALS);
      const detectedBalance = await publicClient.readContract({
        address: MINI_PAY_STABLE_TOKEN_ADDRESS as Address,
        abi: ERC20_TRANSFER_ABI,
        functionName: "balanceOf",
        args: [account as Address]
      });
      const formattedBalance = formatUnits(detectedBalance, MINI_PAY_STABLE_TOKEN_DECIMALS);

      setGame((previous) => ({
        ...previous,
        miniPayWalletAddress: account,
        miniPayTokenAddress: MINI_PAY_STABLE_TOKEN_ADDRESS,
        miniPayRequiredAmount: purchaseAmount,
        miniPayDetectedBalance: formattedBalance,
        miniPayChainId: typeof currentChainId === "string" ? currentChainId : null,
        miniPayPaymentStatus: detectedBalance < requiredAmount ? "failed" : "awaiting-signature",
        miniPayError:
          detectedBalance < requiredAmount ? "Insufficient balance for this test token." : null
      }));

      if (detectedBalance < requiredAmount) {
        throw new Error("Insufficient balance for this test token.");
      }

      const hash = await walletClient.sendTransaction({
        account: account as Address,
        chain: celoSepolia,
        to: MINI_PAY_STABLE_TOKEN_ADDRESS as Address,
        data: encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [
            MINI_PAY_TREASURY_ADDRESS as Address,
            requiredAmount
          ]
        })
      });

      setGame((previous) => ({
        ...previous,
        miniPayWalletAddress: account,
        miniPayTokenAddress: MINI_PAY_STABLE_TOKEN_ADDRESS,
        miniPayRequiredAmount: purchaseAmount,
        miniPayDetectedBalance: formattedBalance,
        miniPayChainId: typeof currentChainId === "string" ? currentChainId : null,
        miniPayTxHash: hash,
        miniPayPaymentStatus: "confirming",
        miniPayError: null
      }));

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: hash as Hash
      });

      if (receipt.status !== "success") {
        throw new Error("MiniPay payment was not confirmed.");
      }

      const purchasedAt = Date.now();
      const paidManagerExpiresAt = purchasedAt + plan.duration * 60 * 60 * 1000;

      setGame((previous) => ({
        ...previous,
        miniPayUnlocked: true,
        miniPayPurchasedPlans: Array.from(new Set([...previous.miniPayPurchasedPlans, plan.id])),
        miniPayLastPurchasedPlan: plan.id,
        miniPayWalletAddress: account,
        miniPayTxHash: hash,
        miniPayUnlockedAt: purchasedAt,
        miniPayPaymentStatus: "confirmed",
        currentPaidManagerPlan: plan.id,
        currentPaidManagerExpiresAt: paidManagerExpiresAt,
        miniPayError: null
      }));
      showNotice(`${plan.name} purchased. Activate before it expires.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "MiniPay unlock failed.";
      setGame((previous) => ({
        ...previous,
        miniPayPaymentStatus: "failed",
        miniPayError: message
      }));
      showNotice(message);
    }
  };

  const activateManager = (plan: ManagerPlan) => {
    const current = Date.now();
    const paidPassExpiresAt =
      plan.locked && game.currentPaidManagerPlan === plan.id
        ? game.currentPaidManagerExpiresAt
        : null;

    if (plan.locked && (!paidPassExpiresAt || paidPassExpiresAt <= current)) {
      showNotice("Buy again to activate this AI Manager.");
      return;
    }
    const managerExpiresAt = plan.locked
      ? paidPassExpiresAt
      : current + plan.duration * 60 * 60 * 1000;

    setGame((previous) => ({
      ...previous,
      managerPlan: plan.id,
      managerActivatedAt: current,
      managerExpiresAt,
      nextAiRunAt: current + AI_DECISION_INTERVAL_MS,
      lastAiActionAt: null,
      lastAiActionResult: null,
      logs: [
        createLog(
          previous.energy,
          `${plan.name} activated`,
          "Automation was enabled by the mine owner.",
          null,
          `Active for ${plan.label}`,
          "gold"
        ),
        ...previous.logs
      ].slice(0, 30)
    }));
    showNotice(`${plan.name} is now running.`);
  };

  const simulateMiniPayUnlock = () => {
    const current = Date.now();
    const premiumPlan = plans.find((plan) => plan.id === "premium");
    setGame((previous) => ({
      ...previous,
      miniPayUnlocked: true,
      miniPayPurchasedPlans: ["basic", "premium"],
      miniPayLastPurchasedPlan: "premium",
      miniPayUnlockedAt: current,
      miniPayPaymentStatus: "confirmed",
      currentPaidManagerPlan: "premium",
      currentPaidManagerExpiresAt: current + (premiumPlan?.duration ?? 6) * 60 * 60 * 1000,
      miniPayError: null
    }));
    showNotice("Emergency fallback unlock enabled.");
  };

  const resetDemo = () => {
    const confirmed = window.confirm(
      "Reset MineAI demo state? This clears local game progress only. Blockchain transactions are not changed."
    );
    if (!confirmed) return;
    Object.keys(window.localStorage)
      .filter((key) => key === STORAGE_KEY || key.startsWith("mineai-"))
      .forEach((key) => window.localStorage.removeItem(key));
    setScreen("welcome");
    setNotice(null);
    setGame(createInitialGame());
    window.location.reload();
  };

  const Welcome = () => (
    <main className="relative flex min-h-[100dvh] flex-col overflow-hidden px-6 pb-8 pt-7">
      <div className="absolute -right-16 top-24 h-48 w-48 rounded-full bg-gold/[0.06] blur-3xl" />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
            <Icon name="pickaxe" className="h-6 w-6" />
          </div>
          <span className="text-lg font-black tracking-tight">
            Mine<span className="text-gold">AI</span>
          </span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/45">
          Alpha Mine
        </span>
      </div>

      <div className="relative flex flex-1 flex-col justify-center py-6">
        <div className="float">
          <MineIllustration />
        </div>
        <div className="-mt-3 text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald/20 bg-emerald/[0.07] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald">
            <Icon name="sparkles" className="h-3.5 w-3.5" />
            Smart idle mining
          </div>
          <h1 className="text-5xl font-black leading-none tracking-[-0.06em]">
            Build your
            <br />
            <span className="bg-gradient-to-r from-gold via-[#ffe49e] to-gold bg-clip-text text-transparent">
              mining empire.
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-[310px] text-sm leading-6 text-white/50">
            Mine manually or let AI Managers run your empire.
          </p>
        </div>
      </div>

      <div className="relative space-y-3">
        <button
          onClick={() => setScreen("dashboard")}
          className="metal-button flex h-16 w-full items-center justify-center gap-3 rounded-2xl text-base font-black uppercase tracking-wide transition"
        >
          <Icon name="pickaxe" className="h-6 w-6" />
          Start Mining
        </button>
        <p className="text-center text-[10px] text-white/25">
          Buy AI Managers from the manager screen inside MiniPay
        </p>
      </div>
    </main>
  );

  const Dashboard = () => (
    <main className="min-h-[100dvh] pb-24">
      <TopBar
        title={
          managerActive ? "Mine online" : "Good luck, miner"
        }
        subtitle={managerActive ? `${activePlan?.name} is working` : "Your first shift is ready"}
        action={
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-bold ${
              managerActive
                ? "border-emerald/25 bg-emerald/10 text-emerald"
                : "border-white/10 bg-white/5 text-white/45"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${managerActive ? "bg-emerald" : "bg-white/30"}`} />
            {managerActive ? "AI ACTIVE" : "AI OFFLINE"}
          </div>
        }
      />

      <section className="px-5">
        <div className="grid grid-cols-3 gap-2.5">
          <ResourceCard label="Gold" value={game.gold} tone="gold" symbol="●" />
          <ResourceCard label="Emerald" value={game.emeralds} tone="emerald" symbol="◆" />
          <ResourceCard label="Diamond" value={game.diamonds} tone="diamond" symbol="◇" />
        </div>

        <div className="glass-card mt-4 rounded-3xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold/70">
                MineCoins
              </p>
              <p className="mt-1 text-3xl font-black text-white">
                {game.mineCoins.toLocaleString()}
              </p>
              <p className="mt-1 text-[11px] text-white/35">
                Convert mined resources into building power.
              </p>
            </div>
            <button
              onClick={convertResourcesToMineCoins}
              className="rounded-2xl border border-gold/25 bg-gold/[0.08] px-4 py-3 text-xs font-black text-gold transition hover:bg-gold/[0.12]"
            >
              Convert +{mineCoinValue}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px] font-bold text-white/35">
            <span className="rounded-xl bg-white/[0.04] px-2 py-2">Gold = 1</span>
            <span className="rounded-xl bg-emerald/[0.07] px-2 py-2 text-emerald/80">
              Emerald = 5
            </span>
            <span className="rounded-xl bg-diamond/[0.07] px-2 py-2 text-diamond/80">
              Diamond = 20
            </span>
          </div>
        </div>

        {managerActive && (
          <div
            aria-live="polite"
            className={`mt-4 flex items-center justify-between rounded-2xl border p-3.5 ${aiStatusTone}`}
          >
            <div className="flex items-center gap-3">
              <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-black/20">
                <span className="absolute inset-0 animate-ping rounded-xl border border-current opacity-20" />
                <Icon name={aiStatusIcon} className="relative h-5 w-5" />
              </span>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.18em] opacity-60">
                  Live AI status
                </p>
                <p className="mt-0.5 text-sm font-black">{aiStatus}</p>
                {managerSessionStatus && (
                  <p className="mt-1 text-[10px] font-bold opacity-70">{managerSessionStatus}</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-bold uppercase tracking-wider opacity-50">Next analysis</p>
              <p className="mt-1 font-mono text-xs font-black">{aiCountdown}</p>
            </div>
          </div>
        )}

        <div className="glass-card mt-4 rounded-3xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-gold/10 text-gold">
                <Icon name="bolt" className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/35">Energy</p>
                <p className="mt-0.5 text-2xl font-black">
                  {game.energy}<span className="text-sm text-white/30"> / {MAX_ENERGY}</span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-white/30">Next charge</p>
              <p className="mt-1 font-mono text-sm font-bold text-gold">+10 in {energyCountdown}</p>
            </div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/35">
            <div
              className="energy-fill h-full rounded-full transition-all duration-500"
              style={{ width: `${game.energy}%` }}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="glass-card rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Mine level</p>
            <div className="mt-2 flex items-end justify-between">
              <p className="text-2xl font-black">{game.mineLevel}</p>
              <span className="text-[10px] font-bold text-gold">{Math.round(progress)}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-black/30">
              <div className="h-full rounded-full bg-gold" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="glass-card rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Production</p>
            <p className="mt-2 text-2xl font-black">{productionRate}</p>
            <p className="mt-1 text-[10px] text-white/35">
              {managerActive ? aiStatus : "Activate AI to automate"}
            </p>
          </div>
        </div>

        <div className="glass-card mt-4 rounded-3xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-lg font-black">Infrastructure</p>
              <p className="text-[11px] text-white/35">
                Spend MineCoins to build your mining base.
              </p>
            </div>
            <span className="rounded-full border border-gold/20 bg-gold/[0.08] px-3 py-1.5 text-[10px] font-black text-gold">
              {game.builtUpgrades.length}/4 BUILT
            </span>
          </div>
          <div className="grid gap-2">
            {infrastructureUpgrades.map((upgrade) => {
              const built = game.builtUpgrades.includes(upgrade.id);
              const affordable = game.mineCoins >= upgrade.cost;
              return (
                <button
                  key={upgrade.id}
                  onClick={() => buildInfrastructure(upgrade)}
                  disabled={built}
                  className={`flex items-center justify-between gap-3 rounded-2xl border p-3 text-left transition ${
                    built
                      ? "border-emerald/20 bg-emerald/10 text-emerald"
                      : affordable
                        ? "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.07]"
                        : "border-white/[0.06] bg-black/10 text-white/45"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-black">{upgrade.name}</span>
                    <span className="mt-0.5 block text-[10px] text-white/35">
                      {upgrade.description}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-xl bg-black/20 px-3 py-2 text-[10px] font-black">
                    {built ? "BUILT" : `${upgrade.cost} MC`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => setScreen("mine")}
          className="metal-button mt-5 flex h-[76px] w-full items-center justify-between rounded-3xl px-6 text-left transition"
        >
          <span className="flex items-center gap-4">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-black/10">
              <Icon name="pickaxe" className="h-7 w-7" />
            </span>
            <span>
              <span className="block text-lg font-black uppercase tracking-wide">Mine now</span>
              <span className="block text-xs font-semibold opacity-60">Choose a resource and dig</span>
            </span>
          </span>
          <Icon name="arrow" className="h-6 w-6" />
        </button>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            onClick={() => setScreen("manager")}
            className="glass-card flex min-h-24 items-center gap-3 rounded-2xl p-4 text-left transition hover:border-emerald/25"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald/10 text-emerald">
              <Icon name="brain" />
            </span>
            <span>
              <span className="block text-sm font-black">AI Manager</span>
              <span className="mt-1 block text-[10px] leading-4 text-white/35">
                {managerActive ? "Manage active shift" : "Automate your mine"}
              </span>
            </span>
          </button>
          <button
            onClick={() => setScreen("log")}
            className="glass-card flex min-h-24 items-center gap-3 rounded-2xl p-4 text-left transition hover:border-diamond/25"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-diamond/10 text-diamond">
              <Icon name="scroll" />
            </span>
            <span>
              <span className="block text-sm font-black">Decision Log</span>
              <span className="mt-1 block text-[10px] leading-4 text-white/35">
                {game.logs.length} AI decisions recorded
              </span>
            </span>
          </button>
        </div>
      </section>
    </main>
  );

  const ManualMining = () => {
    const mineOptions = [
      {
        resource: "gold" as Resource,
        name: "Gold",
        description: "Reliable and energy efficient",
        cost: 5,
        reward: "3-5",
        symbol: "●",
        color: "text-gold",
        border: "border-gold/20",
        glow: "bg-gold/10"
      },
      {
        resource: "emeralds" as Resource,
        name: "Emeralds",
        description: "Balanced risk and reward",
        cost: 10,
        reward: "1-3",
        symbol: "◆",
        color: "text-emerald",
        border: "border-emerald/20",
        glow: "bg-emerald/10"
      },
      {
        resource: "diamonds" as Resource,
        name: "Diamonds",
        description: "Rare, valuable, unpredictable",
        cost: 20,
        reward: "0-1",
        symbol: "◇",
        color: "text-diamond",
        border: "border-diamond/20",
        glow: "bg-diamond/10"
      }
    ];

    return (
      <main className="min-h-[100dvh] pb-28">
        <TopBar title="Manual Mining" subtitle="Spend energy to extract resources" onBack={() => setScreen("dashboard")} />
        <section className="px-5">
          <div className="glass-card flex items-center justify-between rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold/10 text-gold">
                <Icon name="bolt" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">Available energy</p>
                <p className="text-xl font-black">{game.energy} / {MAX_ENERGY}</p>
              </div>
            </div>
            <p className="text-xs font-bold text-gold">+10 in {energyCountdown}</p>
          </div>

          <div className="my-5 text-center">
            <div className="relative mx-auto grid h-28 w-28 place-items-center rounded-full border border-white/10 bg-white/[0.03]">
              <div className="pulse-ring absolute inset-2 rounded-full border border-gold/25" />
              <Icon name="pickaxe" className="relative h-14 w-14 rotate-[-8deg] text-gold" />
            </div>
            <h2 className="mt-4 text-2xl font-black">Choose your target</h2>
            <p className="mt-1 text-xs text-white/40">Every swing consumes energy instantly.</p>
          </div>

          <div className="space-y-3">
            {mineOptions.map((option) => {
              const affordable = game.energy >= option.cost;
              return (
                <button
                  key={option.resource}
                  onClick={() => mine(option.resource)}
                  className={`glass-card group flex w-full items-center gap-4 rounded-3xl border p-4 text-left transition active:scale-[0.99] ${option.border} ${
                    affordable ? "hover:bg-white/[0.055]" : "opacity-55"
                  }`}
                >
                  <span className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-3xl ${option.glow} ${option.color}`}>
                    {option.symbol}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-black">Mine {option.name}</span>
                    <span className="mt-1 block text-[11px] text-white/35">{option.description}</span>
                    <span className="mt-3 flex items-center gap-3">
                      <span className="flex items-center gap-1 text-xs font-bold text-gold">
                        <Icon name="bolt" className="h-3.5 w-3.5" /> {option.cost}
                      </span>
                      <span className={`text-xs font-bold ${option.color}`}>+{option.reward} {option.name}</span>
                    </span>
                  </span>
                  <span className={`grid h-9 w-9 place-items-center rounded-xl ${affordable ? "bg-white/10 text-white" : "bg-white/5 text-white/20"}`}>
                    <Icon name={affordable ? "pickaxe" : "lock"} className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </main>
    );
  };

  const Manager = () => (
    <main className="min-h-[100dvh] pb-28">
      <TopBar
        title="AI Manager"
        subtitle="Intelligent mining automation"
        onBack={() => setScreen("dashboard")}
        action={
          <button
            onClick={() => setScreen("log")}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/60"
            aria-label="Open decision log"
          >
            <Icon name="scroll" className="h-5 w-5" />
          </button>
        }
      />
      <section className="px-5">
        <div className="relative overflow-hidden rounded-3xl border border-emerald/20 bg-gradient-to-br from-[#17362f] to-[#101921] p-5 shadow-emerald">
          <div className="absolute -right-9 -top-9 h-32 w-32 rounded-full bg-emerald/10 blur-2xl" />
          <div className="relative flex gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-emerald/20 bg-emerald/10 text-emerald">
              <Icon name="brain" className="h-8 w-8" />
            </span>
            <div>
              <p className="text-lg font-black">Your mine stops when you leave.</p>
              <p className="mt-2 text-xs leading-5 text-white/45">
                Activate an AI Manager to make smart mining decisions and keep producing while you are away.
              </p>
            </div>
          </div>
          {managerActive && (
            <div
              aria-live="polite"
              className={`relative mt-4 flex items-center justify-between rounded-2xl border p-3 ${aiStatusTone}`}
            >
              <div className="flex items-center gap-2 text-xs font-black">
                <span className="relative grid h-7 w-7 place-items-center rounded-lg bg-black/20">
                  <span className="absolute inset-0 animate-ping rounded-lg border border-current opacity-20" />
                  <Icon name={aiStatusIcon} className="relative h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[9px] uppercase tracking-wider opacity-55">
                    {activePlan?.name}
                  </span>
                  <span className="block">{aiStatus}</span>
                  {managerSessionStatus && (
                    <span className="mt-0.5 block text-[9px] font-bold opacity-65">
                      {managerSessionStatus}
                    </span>
                  )}
                </span>
              </div>
              <span className="font-mono text-xs font-bold opacity-70">Next: {aiCountdown}</span>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-gold/20 bg-gold/[0.06] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gold/80">
                MiniPay proof
              </p>
              <p className="mt-1 text-sm font-black text-white">
                {miniPayStatusLabel[game.miniPayPaymentStatus]}
              </p>
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-[9px] font-black ${
                game.miniPayPaymentStatus === "confirmed"
                  ? "border-emerald/20 bg-emerald/10 text-emerald"
                  : game.miniPayPaymentStatus === "failed"
                    ? "border-red-400/20 bg-red-400/10 text-red-200"
                    : "border-white/10 bg-white/5 text-white/45"
              }`}
            >
              {game.miniPayUnlocked ? "UNLOCKED" : "LOCKED"}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-[11px] text-white/45">
            <div className="flex items-center justify-between gap-3">
              <span>MiniPay app</span>
              <span className={isMiniPayDetected ? "text-emerald" : "text-gold"}>
                {isMiniPayDetected ? "Detected" : "Not detected"}
              </span>
            </div>
            <div className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="flex items-center justify-between gap-3">
                <span>Wallet</span>
                <span className="font-mono text-white/70">
                  {shorten(game.miniPayWalletAddress)}
                </span>
              </div>
              <button
                type="button"
                disabled={!game.miniPayWalletAddress}
                onClick={() => {
                  if (!game.miniPayWalletAddress) return;
                  void navigator.clipboard
                    .writeText(game.miniPayWalletAddress)
                    .then(() => showNotice("MiniPay wallet address copied."))
                    .catch(() => showNotice("Could not copy address."));
                }}
                className="rounded-lg border border-diamond/20 bg-diamond/10 px-3 py-2 text-[10px] font-black text-diamond disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/25"
              >
                Copy Wallet
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Chain ID</span>
              <span className="font-mono text-white/70">{game.miniPayChainId ?? "Unknown"}</span>
            </div>
            <div className="grid gap-1">
              <span>Token address</span>
              <span className="break-all rounded-lg border border-white/10 bg-black/20 px-2 py-1 font-mono text-white/70">
                {game.miniPayTokenAddress ?? MINI_PAY_STABLE_TOKEN_ADDRESS ?? "Not configured"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Required</span>
              <span className="font-mono text-white/70">
                {game.miniPayRequiredAmount ?? MINI_PAY_UNLOCK_AMOUNT} USDC
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Token balance</span>
              <span className="font-mono text-white/70">
                {game.miniPayDetectedBalance ? `${game.miniPayDetectedBalance} USDC` : "Not checked"}
              </span>
            </div>
            <div className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
              <div className="flex items-center justify-between gap-3">
                <span>Tx hash</span>
                <span className="font-mono text-white/70">
                  {game.miniPayTxHash ? shorten(game.miniPayTxHash) : "Not confirmed"}
                </span>
              </div>
              <button
                type="button"
                disabled={!game.miniPayTxHash}
                onClick={() => {
                  if (!game.miniPayTxHash) return;
                  void navigator.clipboard
                    .writeText(game.miniPayTxHash)
                    .then(() => showNotice("MiniPay transaction hash copied."))
                    .catch(() => showNotice("Could not copy transaction hash."));
                }}
                className="rounded-lg border border-diamond/20 bg-diamond/10 px-3 py-2 text-[10px] font-black text-diamond disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/25"
              >
                Copy Tx Hash
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Unlocked</span>
              <span className="text-white/70">
                {game.miniPayUnlockedAt
                  ? new Date(game.miniPayUnlockedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })
                  : "Pending"}
              </span>
            </div>
          </div>
          {miniPayExplorerUrl && (
            <a
              href={miniPayExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex rounded-lg border border-diamond/20 bg-diamond/10 px-3 py-2 text-[10px] font-black text-diamond"
            >
              View Transaction
            </a>
          )}
          {game.miniPayError && (
            <p className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-[10px] font-bold text-red-100">
              {game.miniPayError}
            </p>
          )}
          {!isMiniPayDetected && !game.miniPayUnlocked && (
            <p className="mt-3 rounded-lg border border-gold/20 bg-black/20 px-3 py-2 text-[10px] font-bold text-gold">
              Open MineAI inside MiniPay to buy AI Managers.
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black">Choose a manager</h2>
            <p className="text-[11px] text-white/35">One plan can run at a time</p>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-[10px] font-bold ${
            isMiniPayDetected || game.miniPayUnlocked
              ? "border-emerald/20 bg-emerald/10 text-emerald"
              : "border-white/10 bg-white/5 text-white/35"
          }`}>
            {game.miniPayUnlocked
              ? "MINIPAY PAID"
              : isMiniPayDetected
                ? "MINIPAY READY"
                : "OPEN MINIPAY"}
          </span>
        </div>

        <div className="mt-3 space-y-3">
          {plans.map((plan, index) => {
            const paidPassActive = plan.locked && hasActivePaidManagerPass(plan.id);
            const paidPassExpired = plan.locked && hasExpiredPaidManagerPass(plan.id);
            const paidHistoryExists = plan.locked && game.miniPayPurchasedPlans.includes(plan.id);
            const locked = plan.locked && !paidPassActive;
            const active = game.managerPlan === plan.id && managerActive;
            const shouldBuyAgain = locked && (paidPassExpired || paidHistoryExists);
            const statusLabel = active || paidPassActive
              ? "Active"
              : paidPassExpired
                ? "Expired"
                : shouldBuyAgain
                  ? "Buy Again"
                  : plan.id === "trial"
                    ? "FREE"
                    : "MINIPAY";
            return (
              <div
                key={plan.id}
                className={`relative overflow-hidden rounded-3xl border bg-gradient-to-br p-4 ${plan.accent} ${
                  active ? "border-emerald/45 shadow-emerald" : "border-white/10"
                }`}
              >
                {index === 2 && (
                  <span className="absolute right-0 top-0 rounded-bl-xl bg-gold px-3 py-1 text-[9px] font-black text-black">
                    BEST VALUE
                  </span>
                )}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
                      index === 0 ? "bg-diamond/10 text-diamond" : index === 1 ? "bg-emerald/10 text-emerald" : "bg-gold/10 text-gold"
                    }`}>
                      <Icon name={index === 0 ? "sparkles" : "brain"} className="h-6 w-6" />
                    </span>
                    <div>
                      <h3 className="font-black">{plan.name}</h3>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-white/45">
                        <Icon name="clock" className="h-3.5 w-3.5" /> Runs for {plan.label}
                      </p>
                      {plan.priceUsdc && (
                        <p className="mt-2 inline-flex rounded-lg border border-gold/20 bg-gold/[0.08] px-2.5 py-1 text-[10px] font-black text-gold">
                          {plan.priceUsdc} USDC
                        </p>
                      )}
                      {shouldBuyAgain && (
                        <p className="mt-2 text-[10px] font-bold text-gold">
                          Buy Again required after expiration.
                        </p>
                      )}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${
                    active || paidPassActive
                      ? "bg-emerald/10 text-emerald"
                      : paidPassExpired
                        ? "bg-red-400/10 text-red-100"
                        : shouldBuyAgain
                          ? "bg-gold/10 text-gold"
                          : plan.id === "trial"
                            ? "bg-white/10 text-white/60"
                            : "bg-black/20 text-white/45"
                  }`}>
                    {statusLabel}
                  </span>
                </div>
                <button
                  onClick={() => {
                    if (locked) {
                      void unlockWithMiniPay(plan);
                    } else {
                      activateManager(plan);
                    }
                  }}
                  disabled={active || (locked && miniPayBusy)}
                  className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-black uppercase tracking-wide transition active:scale-[0.99] ${
                    active
                      ? "border border-emerald/20 bg-emerald/10 text-emerald"
                      : locked && miniPayBusy
                        ? "border border-gold/20 bg-gold/10 text-gold"
                      : locked
                        ? "border border-gold/25 bg-gold/[0.08] text-gold"
                        : "bg-white text-black hover:bg-white/90"
                  }`}
                >
                  <Icon
                    name={active ? "check" : locked ? "shield" : "sparkles"}
                    className="h-4 w-4"
                  />
                  {active
                    ? "Manager active"
                    : locked && miniPayBusy
                      ? miniPayStatusLabel[game.miniPayPaymentStatus]
                      : locked
                        ? plan.id === "basic"
                          ? "Buy Basic Manager — 0.000001 USDC"
                          : "Buy Premium Manager — 0.000003 USDC"
                        : "Activate manager"}
                </button>
              </div>
            );
          })}
        </div>

        {ENABLE_SIMULATED_MINIPAY_FALLBACK && !game.miniPayUnlocked && (
          <button
            onClick={simulateMiniPayUnlock}
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] text-[10px] font-black uppercase tracking-wide text-white/35 transition hover:bg-white/[0.06]"
          >
            <Icon name="shield" className="h-4 w-4" />
            Emergency simulated unlock
          </button>
        )}

        <button
          onClick={resetDemo}
          className="mt-4 flex h-9 w-full items-center justify-center rounded-xl border border-red-400/15 bg-red-400/[0.04] text-[10px] font-black uppercase tracking-wide text-red-100/60 transition hover:bg-red-400/[0.08]"
        >
          Reset Demo
        </button>
      </section>
    </main>
  );

  const DecisionLogScreen = () => {
    const toneClasses: Record<DecisionLog["tone"], string> = {
      gold: "bg-gold/10 text-gold border-gold/20",
      emerald: "bg-emerald/10 text-emerald border-emerald/20",
      diamond: "bg-diamond/10 text-diamond border-diamond/20",
      wait: "bg-white/5 text-white/40 border-white/10"
    };
    const sampleLog: DecisionLog = {
      id: "sample",
      time: "09:42 AM",
      energy: 65,
      decision: "Mine Emeralds",
      reason: "Best energy efficiency for the current reserve level.",
      confidence: 92,
      result: "+2 Emeralds",
      tone: "emerald"
    };
    const displayedLogs = game.logs.length ? game.logs : [sampleLog];

    return (
      <main className="min-h-[100dvh] pb-28">
        <TopBar
          title="Decision Log"
          subtitle="See exactly how your AI thinks"
          onBack={() => setScreen("dashboard")}
          action={
            <span className="rounded-full border border-diamond/20 bg-diamond/10 px-3 py-1.5 text-[10px] font-black text-diamond">
              {game.logs.length || 1} EVENTS
            </span>
          }
        />
        <section className="px-5">
          <div className="rounded-2xl border border-diamond/15 bg-diamond/[0.05] p-4">
            <div className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-diamond/10 text-diamond">
                <Icon name="brain" />
              </span>
              <div>
                <p className="text-sm font-black">Transparent by design</p>
                <p className="mt-1 text-[11px] leading-4 text-white/40">
                  Every automated action records the decision, reasoning, confidence, energy, and result.
                </p>
              </div>
            </div>
          </div>

          <div className="relative mt-6 space-y-4 before:absolute before:bottom-5 before:left-[19px] before:top-5 before:w-px before:bg-white/10">
            {displayedLogs.map((log, index) => (
              <article key={log.id} className="relative flex gap-4">
                <span className={`relative z-10 mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${toneClasses[log.tone]}`}>
                  <Icon name={log.tone === "wait" ? "clock" : log.tone === "gold" ? "pickaxe" : "gem"} className="h-5 w-5" />
                </span>
                <div className="glass-card min-w-0 flex-1 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black">{log.decision}</p>
                      <p className="mt-0.5 text-[10px] text-white/30">{log.time}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-gold/[0.08] px-2 py-1 text-[10px] font-bold text-gold">
                      <Icon name="bolt" className="h-3 w-3" /> {log.energy}
                    </span>
                  </div>
                  <div className="mt-3 border-t border-white/[0.07] pt-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/25">Reason</p>
                    <p className="mt-1 text-xs leading-5 text-white/50">{log.reason}</p>
                  </div>
                  {typeof log.confidence === "number" && (
                    <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/25">
                          Confidence
                        </p>
                        <p className="text-xs font-black text-white">{log.confidence}%</p>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={`h-full rounded-full ${
                            log.confidence >= 90
                              ? "bg-emerald"
                              : log.confidence >= 80
                                ? "bg-gold"
                                : "bg-diamond"
                          }`}
                          style={{ width: `${log.confidence}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className={`mt-3 inline-flex rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${toneClasses[log.tone]}`}>
                    Result: {log.result}
                  </div>
                  {index === 0 && game.logs.length === 0 && (
                    <p className="mt-3 text-[9px] italic text-white/20">Example entry. Activate a manager to generate live decisions.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  };

  return (
    <div className="min-h-screen bg-[#05070a]">
      <div className="app-shell relative mx-auto min-h-[100dvh] w-full max-w-[440px] overflow-hidden border-x border-white/[0.04] shadow-2xl">
        {screen === "welcome" && Welcome()}
        {screen === "dashboard" && Dashboard()}
        {screen === "mine" && ManualMining()}
        {screen === "manager" && Manager()}
        {screen === "log" && DecisionLogScreen()}

        {screen !== "welcome" && (
          <nav className="fixed bottom-0 left-1/2 z-40 flex h-[74px] w-full max-w-[440px] -translate-x-1/2 items-center justify-around border-t border-white/[0.07] bg-[#0c1117]/95 px-5 backdrop-blur-xl">
            {[
              { target: "dashboard" as Screen, icon: "home" as IconName, label: "Mine" },
              { target: "manager" as Screen, icon: "brain" as IconName, label: "Manager" },
              { target: "log" as Screen, icon: "scroll" as IconName, label: "Log" }
            ].map((item) => {
              const active = screen === item.target || (screen === "mine" && item.target === "dashboard");
              return (
                <button
                  key={item.target}
                  onClick={() => setScreen(item.target)}
                  className={`flex min-w-20 flex-col items-center gap-1.5 text-[10px] font-bold transition ${
                    active ? "text-gold" : "text-white/30"
                  }`}
                >
                  <span className={`grid h-8 w-12 place-items-center rounded-xl ${active ? "bg-gold/10" : ""}`}>
                    <Icon name={item.icon} className="h-5 w-5" />
                  </span>
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}

        {notice && (
          <div className="fixed left-1/2 top-5 z-50 w-[calc(100%-2rem)] max-w-[408px] -translate-x-1/2">
            <div className="flex items-center gap-3 rounded-2xl border border-gold/20 bg-[#181b1e]/95 p-4 text-sm font-bold shadow-gold backdrop-blur-xl">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
                <Icon name="sparkles" className="h-4 w-4" />
              </span>
              {notice}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
