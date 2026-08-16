using System;
using System.IO;
using UnityEngine;

namespace DoubaoAI.ONI.Assets
{
    internal static class TextureLoader
    {
        internal static Texture2D LoadPng(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                var texture = new Texture2D(2, 2, TextureFormat.ARGB32, false);
                if (!texture.LoadImage(File.ReadAllBytes(path)))
                {
                    UnityEngine.Object.Destroy(texture);
                    return null;
                }
                texture.filterMode = FilterMode.Point;
                texture.wrapMode = TextureWrapMode.Clamp;
                return texture;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[DoubaoAI] 读取形象资源失败：" + ex.Message);
                return null;
            }
        }

        internal static Texture2D CreateHalo(int size)
        {
            var texture = new Texture2D(size, size, TextureFormat.ARGB32, false);
            var pixels = new Color[size * size];
            float center = (size - 1) * 0.5f;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float dx = (x - center) / center;
                    float dy = (y - center) / center;
                    float distance = Mathf.Sqrt(dx * dx + dy * dy);
                    float ring = Mathf.Clamp01(1f - Mathf.Abs(distance - 0.76f) * 12f);
                    float glow = Mathf.Clamp01(1f - distance) * 0.18f;
                    Color tint = x < center ? new Color(0.20f, 0.95f, 1f, ring * 0.8f + glow) : new Color(0.74f, 0.35f, 1f, ring * 0.8f + glow);
                    pixels[y * size + x] = tint;
                }
            }
            texture.SetPixels(pixels);
            texture.Apply(false, false);
            texture.filterMode = FilterMode.Bilinear;
            return texture;
        }
    }
}
