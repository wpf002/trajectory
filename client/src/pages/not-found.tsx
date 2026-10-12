import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PAGE_CLASS, PageHeader } from "@/components/PageHeader";

export default function NotFound() {
  return (
    <div className={PAGE_CLASS}>
      <PageHeader title="Not Found">
        <Link href="/"><Button size="sm" className="h-8 text-xs">Dashboard</Button></Link>
      </PageHeader>
    </div>
  );
}
