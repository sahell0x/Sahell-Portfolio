export interface Social {
  name: string;
  handle: string;
  url: string;
  /** terminal command alias, e.g. `github` opens the link */
  cmd: string;
}

export const socials: Social[] = [
  {
    name: "GitHub",
    handle: "@sahell0x",
    url: "https://github.com/sahell0x",
    cmd: "github",
  },
  {
    name: "LinkedIn",
    handle: "in/sahell0x",
    url: "https://linkedin.com/in/sahell0x",
    cmd: "linkedin",
  },
  {
    name: "LeetCode",
    handle: "Sahell",
    url: "https://leetcode.com/Sahell",
    cmd: "leetcode",
  },
  {
    name: "Hugging Face",
    handle: "sahellx",
    url: "https://huggingface.co/sahellx",
    cmd: "huggingface",
  },
  {
    name: "Email",
    handle: "s.sahil9752@gmail.com",
    url: "mailto:s.sahil9752@gmail.com",
    cmd: "email",
  },
];
