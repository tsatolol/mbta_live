// E2E の前に一度だけ: E2E 用の DB を作り直し、マイグレーションを適用して、通常の状態（base）を入れる
import { seedE2e } from "./helpers/seed";

export default function globalSetup(): void {
  seedE2e("base", { migrate: true });
}
