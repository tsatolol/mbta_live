// /analytics は運行間隔の画面へ（最初のタブ）
import { redirect } from "next/navigation";

export default function AnalyticsIndex() {
  redirect("/analytics/headways");
}
