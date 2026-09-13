export function passwordResetDelivery(websiteDomain) {
  return {
    override: original => ({
      ...original,
      async sendEmail(input) {
        const source = new URL(input.passwordResetLink);
        const link = new URL(websiteDomain);
        link.search = "";
        link.hash = "";
        link.searchParams.set("resetPassword", "1");
        link.searchParams.set("token", source.searchParams.get("token") || "");
        link.searchParams.set("tenantId", input.tenantId);
        return original.sendEmail({ ...input, passwordResetLink: link.href });
      }
    })
  };
}
