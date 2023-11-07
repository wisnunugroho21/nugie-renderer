#include "material_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	MaterialModel::MaterialModel(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	MaterialModel::~MaterialModel() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	void MaterialModel::createBuffers() {
		uint32_t materialSize = static_cast<uint32_t>(sizeof(Material));

		this->stagingBuffer = new NugieVulkan::Buffer(
			this->device,
			materialSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->buffer = new NugieVulkan::Buffer(
			this->device,
			materialSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void MaterialModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<Material> materials) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(Material)) * static_cast<VkDeviceSize>(materials.size());

		this->stagingBuffer->map();
		this->stagingBuffer->writeToBuffer((void *) materials.data(), bufferSize);
		
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	}
} // namespace NugieApp

