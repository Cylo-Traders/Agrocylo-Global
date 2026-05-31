import React from 'react';

interface DarkModeImageProps {
  srcLight: string;
  srcDark: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}

export default function DarkModeImage({
  srcLight,
  srcDark,
  alt,
  className = '',
  width,
  height,
}: DarkModeImageProps) {
  return (
    <picture>
      <source srcSet={srcDark} media="(prefers-color-scheme: dark)" />
      <img
        src={srcLight}
        alt={alt}
        className={`dark:hidden ${className}`}
        width={width}
        height={height}
      />
      <img
        src={srcDark}
        alt={alt}
        className={`hidden dark:block ${className}`}
        width={width}
        height={height}
      />
    </picture>
  );
}