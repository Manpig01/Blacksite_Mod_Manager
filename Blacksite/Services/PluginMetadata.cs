using System.Diagnostics;
using System.IO;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text;
using System.Text.RegularExpressions;

namespace Blacksite.Services;

/// <summary>
/// Reads real assembly metadata from mod DLLs without loading them:
/// decodes the BepInEx [BepInPlugin(guid, name, version)] custom attribute straight from
/// the PE metadata tables (System.Reflection.Metadata), plus file version resources as fallback.
/// </summary>
public static partial class PluginMetadata
{
    public sealed record BepInPluginInfo(string Guid, string Name, string? Version);

    public static BepInPluginInfo? TryReadBepInPlugin(string filePath)
    {
        try
        {
            using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return TryReadBepInPlugin(fs);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or BadImageFormatException or ArgumentException)
        {
            return null;
        }
    }

    public static BepInPluginInfo? TryReadBepInPlugin(Stream stream)
    {
        try
        {
            using var peReader = new PEReader(stream);
            if (!peReader.HasMetadata) return null;

            MetadataReader md = peReader.GetMetadataReader();
            foreach (CustomAttributeHandle handle in md.CustomAttributes)
            {
                CustomAttribute attribute = md.GetCustomAttribute(handle);
                if (!IsBepInPluginAttribute(md, attribute)) continue;

                byte[] blob = md.GetBlobBytes(attribute.Value);
                BepInPluginInfo? decoded = DecodeBepInPluginBlob(blob);
                if (decoded is not null) return decoded;
            }
        }
        catch (Exception ex) when (ex is BadImageFormatException or IOException or InvalidOperationException)
        {
            // Not a managed PE or unreadable metadata — treat as "no plugin info".
        }
        return null;
    }

    private static bool IsBepInPluginAttribute(MetadataReader md, CustomAttribute attribute)
    {
        string? typeName = attribute.Constructor.Kind switch
        {
            HandleKind.MemberReference => GetMemberRefParentTypeName(md, (MemberReferenceHandle)attribute.Constructor),
            HandleKind.MethodDefinition => GetMethodDefParentTypeName(md, (MethodDefinitionHandle)attribute.Constructor),
            _ => null
        };
        return typeName is "BepInPluginAttribute" or "BepInPlugin";
    }

    private static string? GetMemberRefParentTypeName(MetadataReader md, MemberReferenceHandle handle)
    {
        MemberReference memberRef = md.GetMemberReference(handle);
        if (memberRef.Parent.Kind != HandleKind.TypeReference) return null;
        TypeReference typeRef = md.GetTypeReference((TypeReferenceHandle)memberRef.Parent);
        return md.GetString(typeRef.Name);
    }

    private static string? GetMethodDefParentTypeName(MetadataReader md, MethodDefinitionHandle handle)
    {
        MethodDefinition methodDef = md.GetMethodDefinition(handle);
        TypeDefinition typeDef = md.GetTypeDefinition(methodDef.GetDeclaringType());
        return md.GetString(typeDef.Name);
    }

    /// <summary>
    /// Decodes the custom-attribute blob: 0x0001 prolog followed by three serialized strings
    /// (GUID, Name, Version) per ECMA-335 §II.23.3.
    /// </summary>
    private static BepInPluginInfo? DecodeBepInPluginBlob(byte[] blob)
    {
        if (blob.Length < 2 || blob[0] != 0x01 || blob[1] != 0x00) return null;
        int pos = 2;

        string? guid = ReadSerializedString(blob, ref pos);
        string? name = ReadSerializedString(blob, ref pos);
        string? version = ReadSerializedString(blob, ref pos);

        if (string.IsNullOrEmpty(guid) && string.IsNullOrEmpty(name)) return null;
        return new BepInPluginInfo(guid ?? string.Empty, name ?? string.Empty, CleanVersion(version));
    }

    private static string? ReadSerializedString(byte[] blob, ref int pos)
    {
        if (pos >= blob.Length) return null;
        if (blob[pos] == 0xFF) { pos++; return null; } // null string

        int length;
        byte b0 = blob[pos++];
        if ((b0 & 0x80) == 0)
        {
            length = b0;
        }
        else if ((b0 & 0xC0) == 0x80)
        {
            if (pos >= blob.Length) return null;
            length = ((b0 & 0x3F) << 8) | blob[pos++];
        }
        else if ((b0 & 0xE0) == 0xC0)
        {
            if (pos + 2 >= blob.Length) return null;
            length = ((b0 & 0x1F) << 24) | (blob[pos] << 16) | (blob[pos + 1] << 8) | blob[pos + 2];
            pos += 3;
        }
        else
        {
            return null;
        }

        if (length < 0 || pos + length > blob.Length) return null;
        string value = Encoding.UTF8.GetString(blob, pos, length);
        pos += length;
        return value;
    }

    /// <summary>Version-resource based fallback for assemblies without a decodable plugin attribute.</summary>
    public static string? TryGetFileVersion(string filePath)
    {
        try
        {
            FileVersionInfo info = FileVersionInfo.GetVersionInfo(filePath);
            string? raw = info.ProductVersion ?? info.FileVersion;
            return CleanVersion(raw);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or FileNotFoundException)
        {
            return null;
        }
    }

    public static string? CleanVersion(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        Match match = VersionRegex().Match(raw.Trim());
        return match.Success ? match.Value : raw.Trim();
    }

    [GeneratedRegex(@"\d+\.\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z\-.]+)?")]
    private static partial Regex VersionRegex();
}
