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
	struct hash<NugieApp::Position> {
		size_t operator () (NugieApp::Position const &position) const {
			size_t seed = 0;
			hashCombine(seed, position.position);
			return seed;
		}
	};
} 

namespace NugieApp {
  LoadedModel loadObjModel(const std::string &filePath) {
    LoadedModel loadedModel;
    
    tinyobj::attrib_t attrib;
		std::vector<tinyobj::shape_t> shapes;
		std::vector<tinyobj::material_t> materials;
		std::string warn, err;

		if (!tinyobj::LoadObj(&attrib, &shapes, &materials, &warn, &err, filePath.c_str())) {
			throw std::runtime_error(warn + err);
		}

		std::unordered_map<Position, uint32_t> uniqueVertices{};
		for (const auto &shape: shapes) {
			for (const auto &index: shape.mesh.indices) {
				Position position{};
        Normal normal{};
				TextCoord textCoord{};

				if (index.vertex_index >= 0) {
					position.position = {
						attrib.vertices[3 * index.vertex_index + 0],
						attrib.vertices[3 * index.vertex_index + 1],
						attrib.vertices[3 * index.vertex_index + 2],
            1.0f
					};
				}

				if (index.normal_index >= 0) {
					normal.normal = {
						attrib.normals[3 * index.normal_index + 0],
						attrib.normals[3 * index.normal_index + 1],
						attrib.normals[3 * index.normal_index + 2],
            0.0f
					};
				}

				if (index.texcoord_index >= 0) {
					textCoord.textCoord = { // temoirary. for OBJ object only
						attrib.texcoords[2 * index.texcoord_index + 0],
    				1.0f - attrib.texcoords[2 * index.texcoord_index + 1]
					};
				}

				if (uniqueVertices.count(position) == 0) {
					uniqueVertices[position] = static_cast<uint32_t>(loadedModel.positions.size());

					loadedModel.positions.push_back(position);
          loadedModel.normals.push_back(normal);
					loadedModel.textCoords.push_back(textCoord);
				}

				loadedModel.indices.push_back(uniqueVertices[position]);
			}
		}

    return loadedModel;
  }
}