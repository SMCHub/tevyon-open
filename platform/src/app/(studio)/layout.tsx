import { StudioProvider } from "@/components/studio/studio-context";
import { TopNav } from "@/components/studio/top-nav";
import "./studio.css";
// After studio.css, so the preview's own stylesheet loads later and wins ties.
import { PreviewProvider } from "@/components/studio/preview-host";

export default function StudioLayout({ children }: LayoutProps<"/">) {
  return (
    <StudioProvider>
      <PreviewProvider>
        <div className="app">
          <TopNav />
          <main className="app__main">{children}</main>
        </div>
      </PreviewProvider>
    </StudioProvider>
  );
}
