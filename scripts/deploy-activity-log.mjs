import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";

const privateKey = process.env.MINEAI_DEPLOYER_PRIVATE_KEY;
const rpcUrl = process.env.MINEAI_CELO_SEPOLIA_RPC_URL ?? celoSepolia.rpcUrls.default.http[0];

if (!privateKey) {
  throw new Error("Set MINEAI_DEPLOYER_PRIVATE_KEY with a funded Celo Sepolia deployer key.");
}

const normalizedPrivateKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
const account = privateKeyToAccount(normalizedPrivateKey);
const contractPath = path.join(process.cwd(), "contracts", "MineAIActivityLog.sol");
const source = fs.readFileSync(contractPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "MineAIActivityLog.sol": {
      content: source
    }
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"]
      }
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors?.filter((error) => error.severity === "error") ?? [];

if (errors.length > 0) {
  throw new Error(errors.map((error) => error.formattedMessage).join("\n"));
}

const compiled = output.contracts["MineAIActivityLog.sol"].MineAIActivityLog;
const abi = compiled.abi;
const bytecode = `0x${compiled.evm.bytecode.object}`;

const walletClient = createWalletClient({
  account,
  chain: celoSepolia,
  transport: http(rpcUrl)
});

const publicClient = createPublicClient({
  chain: celoSepolia,
  transport: http(rpcUrl)
});

console.log(`Deploying MineAIActivityLog from ${account.address}`);

const hash = await walletClient.deployContract({
  abi,
  bytecode
});

console.log(`Deployment transaction: ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });

if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`Deployment failed. Transaction hash: ${hash}`);
}

const deployment = {
  contractName: "MineAIActivityLog",
  network: "Celo Sepolia",
  chainId: celoSepolia.id,
  contractAddress: receipt.contractAddress,
  deploymentTransactionHash: hash,
  deployer: account.address,
  deployedAt: new Date().toISOString()
};

fs.mkdirSync(path.join(process.cwd(), "deployments"), { recursive: true });
fs.writeFileSync(
  path.join(process.cwd(), "deployments", "mineai-activity-log.celo-sepolia.json"),
  `${JSON.stringify(deployment, null, 2)}\n`
);

console.log(JSON.stringify(deployment, null, 2));
