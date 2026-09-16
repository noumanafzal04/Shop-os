/**
 * MOVED to `@cartze/core`. This line is the seam.
 *
 * Every import of this path in the app keeps working while the icons
 * themselves live where CartZe Partner can reach them. Repointing the call
 * sites in the commit that moves the file would be one change with nothing
 * green in between, and this app has a released APK.
 */
export * from "@cartze/core/ui/icons";
