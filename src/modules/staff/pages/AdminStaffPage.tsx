import { UserCircleIcon } from "../../../icons";
import { PageHeader } from "../../admin/components/kit";
import StaffPage from "../StaffPage";

const TITLE = "Platform Staff";
const SUBTITLE = "The people who help run the platform — and exactly what each of them may do on it.";

export default function AdminStaffPage() {
  return (
    <StaffPage
      title={TITLE}
      subtitle={SUBTITLE}
      basePath="/admin/staff"
      // The console's own head: its icon, in its own colour, like every
      // other screen on the rail.
      header={(add) => <PageHeader icon={<UserCircleIcon />} tone="slate" title={TITLE} subtitle={SUBTITLE} actions={add} />}
    />
  );
}
