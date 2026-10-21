import { NeonAuthUserRow } from "./neon-auth-user-row";

export function NeonAuthUsersTable({ rows }: { rows: any[] }) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <caption className="sr-only">Neon Auth project users</caption>
        <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
          <tr className="border-b border-border text-sm font-semibold text-foreground">
            <th scope="col" className="px-5 py-4">User</th>
            <th scope="col" className="px-5 py-4">Email status</th>
            <th scope="col" className="px-5 py-4">Sign-in method</th>
            <th scope="col" className="px-5 py-4 text-right">Created</th>
          </tr>
        </thead>
        <tbody>{rows.map((user) => <NeonAuthUserRow key={user.UID} user={user} />)}</tbody>
      </table>
    </div>
  );
}
