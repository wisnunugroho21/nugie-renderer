#include "load_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define TINYOBJLOADER_IMPLEMENTATION
#include <tiny_obj_loader.h>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace std {
  template <typename T, typename... Rest>
  void hashCombine(std::size_t& seed, const T& v, const Rest&... rest) {
    seed ^= std::hash<T>{}(v) + 0x9e3779b9 + (seed << 6) + (seed >> 2);
    (hashCombine(seed, rest), ...);
  };
  
	template<>
	struct hash<NugieApp::Vertex> {
		size_t operator () (NugieApp::Vertex const &vertex) const {
			size_t seed = 0;
			hashCombine(seed, vertex.position);
			return seed;
		}
	};
}

namespace NugieApp {
	uint32_t findSameVertex(Vertex vertex, NormText normText, std::vector<Vertex> vertices, std::vector<NormText> normTexts) {
		for (uint32_t i = 0; i < static_cast<uint32_t>(vertices.size()); i++) {
			if (vertices[i].position == vertex.position && normTexts[i].normal == normText.normal && normTexts[i].textCoord == normText.textCoord) {
				return i + 1u;
			}
		}

		return 0u;		
	}

  LoadedBuffer loadObjModel(const std::string &filePath) {
    LoadedBuffer loadedBuffer;
    
    tinyobj::attrib_t attrib;
		std::vector<tinyobj::shape_t> shapes;
		std::vector<tinyobj::material_t> materials;
		std::string warn, err;

		if (!tinyobj::LoadObj(&attrib, &shapes, &materials, &err, &warn, filePath.c_str())) {
			throw std::runtime_error(warn + err);
		}

		for (const auto &shape: shapes) {
			for (const auto &index: shape.mesh.indices) {
				Vertex vertex;
				NormText normText;

				if (index.vertex_index >= 0) {
					vertex.position = {
						attrib.vertices[3 * index.vertex_index + 0],
						attrib.vertices[3 * index.vertex_index + 1],
						attrib.vertices[3 * index.vertex_index + 2],
            1.0f
					};
				}

				if (index.normal_index >= 0) {
					normText.normal = {
						attrib.normals[3 * index.normal_index + 0],
						attrib.normals[3 * index.normal_index + 1],
						attrib.normals[3 * index.normal_index + 2],
            0.0f
					};
				}

				if (index.texcoord_index >= 0) {
					normText.textCoord = { // temoirary. for OBJ object only
						attrib.texcoords[2 * index.texcoord_index + 0],
    				1.0f - attrib.texcoords[2 * index.texcoord_index + 1]
					};
				}

				uint32_t sameVertex = findSameVertex(vertex, normText, loadedBuffer.vertices, loadedBuffer.normTexts);

				if (sameVertex == 0u) {
					uint32_t index = static_cast<uint32_t>(loadedBuffer.vertices.size());

					loadedBuffer.vertices.emplace_back(vertex);
					loadedBuffer.normTexts.emplace_back(normText);
					loadedBuffer.indices.emplace_back(index);
				} else {
					loadedBuffer.indices.emplace_back(sameVertex - 1u);
				}
			}
		}

    return loadedBuffer;
  }
}