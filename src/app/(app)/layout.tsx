import { Nav } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <Nav />
      <main id="main" className="page">{children}</main>
    </>
  );
}
