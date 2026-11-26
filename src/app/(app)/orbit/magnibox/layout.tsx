import { MagniboxNavigation } from "@/components/magnibox-navigation";
import "./magnibox.css";

export default function MagniboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mg-workspace">
      <MagniboxNavigation />
      <div className="mg-workspace-content">{children}</div>
    </div>
  );
}
