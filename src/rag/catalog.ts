import type { Article } from "./Article";

const simpleWikipedia = (title: string) =>
  `https://simple.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;

const article = (title: string, summary: string): Article => ({
  id: title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
  title,
  summary,
  url: simpleWikipedia(title),
});

export const catalog: ReadonlyArray<Article> = [
  article(
    "Photosynthesis",
    "Photosynthesis is how plants, algae, and some bacteria make food from light. They take in carbon dioxide and water and use energy from sunlight to make sugar. Oxygen is released as a waste product.",
  ),
  article(
    "Moon",
    "The Moon is the only natural satellite of Earth. It takes about 27 days to orbit Earth. Its gravity causes most of the tides in the oceans.",
  ),
  article(
    "Volcano",
    "A volcano is an opening in the surface of a planet where melted rock, ash, and gas escape from below. Melted rock is called magma underground and lava once it reaches the surface.",
  ),
  article(
    "Honey bee",
    "Honey bees are insects that live in large colonies with one queen. Worker bees collect nectar and pollen from flowers and make honey. They help pollinate many crops.",
  ),
  article(
    "Internet",
    "The Internet is a worldwide network of connected computers. Computers on it share data using common rules called protocols, such as TCP/IP. The World Wide Web is one service that runs on the Internet.",
  ),
  article(
    "Black hole",
    "A black hole is a place in space where gravity is so strong that nothing, not even light, can escape. Many black holes form when very large stars collapse at the end of their lives.",
  ),
  article(
    "DNA",
    "DNA is a molecule that carries the genetic instructions of living things. It has the shape of a double helix. Genes are sections of DNA that tell cells how to make proteins.",
  ),
  article(
    "Ancient Egypt",
    "Ancient Egypt was a civilization along the Nile River in northeast Africa. It lasted for about three thousand years. Its people built pyramids and wrote with hieroglyphs.",
  ),
  article(
    "Python (programming language)",
    "Python is a programming language created by Guido van Rossum and first released in 1991. It is known for code that is easy to read. It is used for websites, data science, and automation.",
  ),
  article(
    "Rainforest",
    "A rainforest is a forest that gets a lot of rain every year. Tropical rainforests are warm and are home to more than half of the plant and animal species on Earth.",
  ),
];
