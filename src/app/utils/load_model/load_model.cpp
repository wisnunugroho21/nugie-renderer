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
			hashCombine(seed, vertex.position, vertex.textCoord);
			return seed;
		}
	};
} 

namespace NugieApp {
  LoadedModel loadObjModel(const std::string &filePath, uint32_t materialIndex, uint32_t offsetIndex) {
    LoadedModel loadedModel;
    
    tinyobj::attrib_t attrib;
		std::vector<tinyobj::shape_t> shapes;
		std::vector<tinyobj::material_t> materials;
		std::string warn, err;

		if (!tinyobj::LoadObj(&attrib, &shapes, &materials, &warn, &err, filePath.c_str())) {
			throw std::runtime_error(warn + err);
		}

		std::unordered_map<Vertex, uint32_t> uniqueVertices{};
		for (auto &&shape : shapes) {
			uint32_t numTriangle = static_cast<uint32_t>(shape.mesh.indices.size() / 3);

			for (uint32_t i = 0; i < numTriangle; i++) {
				uint32_t vertexIndex0 = shape.mesh.indices[3 * i + 0].vertex_index;
				uint32_t vertexIndex1 = shape.mesh.indices[3 * i + 1].vertex_index;
				uint32_t vertexIndex2 = shape.mesh.indices[3 * i + 2].vertex_index;

				uint32_t texCoordIndex0 = shape.mesh.indices[3 * i + 0].texcoord_index;
				uint32_t texCoordIndex1 = shape.mesh.indices[3 * i + 1].texcoord_index;
				uint32_t texCoordIndex2 = shape.mesh.indices[3 * i + 2].texcoord_index;

				Vertex vertex0{};
				Vertex vertex1{};
				Vertex vertex2{};

				vertex0.position = glm::vec4{
					attrib.vertices[3 * vertexIndex0 + 0],
					attrib.vertices[3 * vertexIndex0 + 1],
					attrib.vertices[3 * vertexIndex0 + 2],
					1.0f
				};

				vertex1.position = glm::vec4{
					attrib.vertices[3 * vertexIndex1 + 0],
					attrib.vertices[3 * vertexIndex1 + 1],
					attrib.vertices[3 * vertexIndex1 + 2],
					1.0f
				};

				vertex2.position = glm::vec4{
					attrib.vertices[3 * vertexIndex2 + 0],
					attrib.vertices[3 * vertexIndex2 + 1],
					attrib.vertices[3 * vertexIndex2 + 2],
					1.0f
				};

				vertex0.textCoord = glm::vec2{
					attrib.texcoords[2 * texCoordIndex0 + 0],
					1.0f - attrib.texcoords[2 * texCoordIndex0 + 1]
				};

				vertex1.textCoord = glm::vec2{
					attrib.texcoords[2 * texCoordIndex1 + 0],
					1.0f - attrib.texcoords[2 * texCoordIndex1 + 1]
				};

				vertex2.textCoord = glm::vec2{
					attrib.texcoords[2 * texCoordIndex2 + 0],
					1.0f - attrib.texcoords[2 * texCoordIndex2 + 1]
				};

				if (uniqueVertices.count(vertex0) == 0) {
					uniqueVertices[vertex0] = static_cast<uint32_t>(loadedModel.vertices.size());
					loadedModel.vertices.emplace_back(vertex0);
				}

				if (uniqueVertices.count(vertex1) == 0) {
					uniqueVertices[vertex1] = static_cast<uint32_t>(loadedModel.vertices.size());
					loadedModel.vertices.emplace_back(vertex1);
				}

				if (uniqueVertices.count(vertex2) == 0) {
					uniqueVertices[vertex2] = static_cast<uint32_t>(loadedModel.vertices.size());
					loadedModel.vertices.emplace_back(vertex2);
				}

				loadedModel.primitives.emplace_back(Primitive{
					glm::uvec3 {
						uniqueVertices[vertex0] + offsetIndex,
						uniqueVertices[vertex1] + offsetIndex,
						uniqueVertices[vertex2] + offsetIndex
					}, 
					materialIndex
				});
			}
		}

    return loadedModel;
  }
}