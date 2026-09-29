using System.IO;

namespace Blacksite.Services;

/// <summary>
/// One-time migration for SPT 4.x installs: the manager previously installed server mods into the
/// classic root\user\mods, which on SPT 4.1+ sits outside the SPT_Runtime folder the server
/// actually loads from — and game-data overlays (EscapeFromTarkov_Data payloads shipped by some
/// mods) stranded inside user\mods. Moves server mods into {root}\{runtime}\user\mods and merges
/// data overlays into the root data folder, using real file operations only.
/// BepInEx is deliberately never touched: on SPT 4.1 the client plugins stay at the install root.
/// </summary>
public static class SptLayoutMigrator
{
    /// <summary>Outcome summary: how many mod items moved, how many were skipped because the
    /// target already existed, how many game-data files merged, whether the legacy folders are gone.</summary>
    public sealed record MigrationResult(int ItemsMoved, int ItemsSkippedExisting, int DataFilesMerged, bool LegacyFoldersRemoved);

    /// <summary>True when root\user\mods still holds content that belongs inside the runtime folder.
    /// (BepInEx at the install root is the correct SPT 4.1 location — never legacy content.)</summary>
    public static bool HasLegacyContent(string sptRoot) =>
        HasEntries(Path.Combine(sptRoot, "user", "mods"));

    /// <summary>True when the directory exists and holds at least one entry.</summary>
    public static bool HasEntries(string dir)
    {
        try { return Directory.Exists(dir) && Directory.EnumerateFileSystemEntries(dir).Any(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; }
    }

    /// <summary>
    /// Moves legacy root\user\mods content into {root}\{runtime}\user\mods, and any
    /// EscapeFromTarkov_Data overlay found inside user\mods up into the install root's data
    /// folder (merged recursively — the mod's files overwrite existing game files, as they are
    /// the payload the mod ships). BepInEx is never touched; nothing non-empty is ever deleted.
    /// </summary>
    public static MigrationResult Migrate(string sptRoot, string runtimeFolder)
    {
        int moved = 0, skipped = 0, dataMerged = 0;

        string legacyMods = Path.Combine(sptRoot, "user", "mods");
        string runtimeMods = Path.Combine(sptRoot, runtimeFolder, "user", "mods");
        if (HasEntries(legacyMods))
        {
            Directory.CreateDirectory(runtimeMods);
            foreach (string entry in Directory.EnumerateFileSystemEntries(legacyMods).ToList())
            {
                string name = Path.GetFileName(entry);
                if (string.Equals(name, "EscapeFromTarkov_Data", StringComparison.OrdinalIgnoreCase) && Directory.Exists(entry))
                {
                    // A game-data overlay installed into the mods folder by mistake — merge it
                    // into the root's EscapeFromTarkov_Data (SPT 4.x keeps the data folder at the root).
                    dataMerged += MergeMoveDirectory(entry, Path.Combine(sptRoot, "EscapeFromTarkov_Data"));
                    continue;
                }
                MoveEntry(entry, Path.Combine(runtimeMods, name), ref moved, ref skipped);
            }
        }

        // Remove the emptied legacy server-mod folders — nothing non-empty is ever deleted.
        // (BepInEx is untouched: root\BepInEx\plugins is the correct SPT 4.1 location.)
        bool removed = TryDeleteIfEmpty(legacyMods) &
                       TryDeleteIfEmpty(Path.Combine(sptRoot, "user"));
        return new MigrationResult(moved, skipped, dataMerged, removed);
    }

    /// <summary>Moves a file or directory; skips (and counts) when the target already exists.</summary>
    private static void MoveEntry(string source, string target, ref int moved, ref int skipped)
    {
        if (Directory.Exists(target) || File.Exists(target))
        {
            skipped++;
            return;
        }
        if (Directory.Exists(source)) Directory.Move(source, target);
        else File.Move(source, target);
        moved++;
    }

    /// <summary>Recursively merges a directory into the target (files overwrite, subfolders merge).
    /// Returns the number of files moved. The source folder is removed once empty.</summary>
    private static int MergeMoveDirectory(string source, string target)
    {
        int files = 0;
        Directory.CreateDirectory(target);
        foreach (string file in Directory.EnumerateFiles(source).ToList())
        {
            File.Move(file, Path.Combine(target, Path.GetFileName(file)), overwrite: true);
            files++;
        }
        foreach (string dir in Directory.EnumerateDirectories(source).ToList())
            files += MergeMoveDirectory(dir, Path.Combine(target, Path.GetFileName(dir)));
        // Everything has been moved out; remove the leftovers (empty subfolders).
        ArchiveExtractor.DeleteDirectoryRobust(source);
        return files;
    }

    /// <summary>Deletes the directory when it exists and is empty. Returns true when it is gone.</summary>
    private static bool TryDeleteIfEmpty(string dir)
    {
        try
        {
            if (!Directory.Exists(dir)) return true;
            if (Directory.EnumerateFileSystemEntries(dir).Any()) return false;
            Directory.Delete(dir);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }
}
