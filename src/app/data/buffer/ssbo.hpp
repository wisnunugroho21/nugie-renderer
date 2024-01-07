#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"

#include <vector>
#include <memory>

namespace NugieApp {
	template <typename T>
	class ShaderStorageBufferObject {
		public:
			ShaderStorageBufferObject(NugieVulkan::Device* device, uint32_t totalSize = 1000000u);
			~ShaderStorageBufferObject();

			VkDescriptorBufferInfo getInfo() const { return this->buffer->descriptorInfo(); }
			NugieVulkan::Buffer* getBuffer() const { return this->buffer; }
			uint32_t size() const { return this->count; }

			void replace(NugieVulkan::CommandBuffer* commandBuffer, std::vector<T> objects);
			
		private:
			NugieVulkan::Device* device;
			uint32_t count;

			NugieVulkan::Buffer* stagingBuffer;
			NugieVulkan::Buffer* buffer;

			void createBuffers(uint32_t totalSize = 1000000u);
	};

	template <typename T>
	ShaderStorageBufferObject<T>::ShaderStorageBufferObject(NugieVulkan::Device* device, uint32_t totalSize) : device{device} {
		this->createBuffers(totalSize);
	}

	template <typename T>
	ShaderStorageBufferObject<T>::~ShaderStorageBufferObject() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	template <typename T>
	void ShaderStorageBufferObject<T>::createBuffers(uint32_t totalSize) {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(T));

		this->stagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			totalSize,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VMA_MEMORY_USAGE_AUTO,
			VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
		);

		this->buffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			totalSize,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VMA_MEMORY_USAGE_AUTO,
			VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
		);

		this->stagingBuffer->map();
	}

	template <typename T>
	void ShaderStorageBufferObject<T>::replace(NugieVulkan::CommandBuffer* commandBuffer, std::vector<T> objects) {
		this->count = static_cast<uint32_t>(objects.size());
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(T)) * static_cast<VkDeviceSize>(this->count);
		
		this->stagingBuffer->writeToBuffer((void *) objects.data(), bufferSize);
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	}
} // namespace NugieApp
